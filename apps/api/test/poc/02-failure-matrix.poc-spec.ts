import { Client } from 'pg';
import { CommandRelay } from '../../src/modules/process/application/bridge/command-relay';
import { EngineTenantMismatchError } from '../../src/modules/process/application/ports/process-engine';
import { testDatabaseUrl } from '../db/test-database';
import { FaultyEngine } from './support/faulty-engine';
import { FLOWABLE_DATABASE_URL, flowableRest, flowableSql, instancesOf } from './support/flowable';
import { eventually, expectCriterion, Harness, sleep, TENANTS } from './support/harness';
import { record } from './support/results';

// PoC 3, the failure matrix with failures injected in process: each test breaks the bridge at
// one point, lets it recover, and checks the criterion (no task lost, none duplicated) for
// every request it touched, on both tenant fixtures.

const LEASE_MS = 1_500;

describe('PoC 3: failure matrix (injected in process)', () => {
  const h = new Harness();

  beforeAll(() => h.seed());
  afterAll(() => h.close());
  beforeEach(() => {
    h.relay = h.newRelay({ leaseMs: LEASE_MS });
  });
  afterEach(async () => {
    h.engine.reset();
    h.escalateAfterSeconds = 3600;
    // Incidents are per test: each test that expects one asserts it, then the log is cleared.
    await h.sql('DELETE FROM process.incident');
  });

  /** One request of `code` surfaced to its approver; returns its id and the core task id. */
  async function openRequest(code: string) {
    const requestId = await h.submitLeave(code);
    await h.converge(code);
    const inbox = await h.inboxOf(code, 'approver');
    const task = inbox.find((entry) => entry.requestId === requestId)!;
    return { requestId, taskId: task.id };
  }

  async function outboxRow(code: string, aggregateId: string) {
    const [row] = await h.sql<{
      attempts: number;
      published_at: Date | null;
      last_error: string | null;
    }>(
      'SELECT attempts, published_at, last_error FROM process.outbox WHERE tenant_id = $1 AND aggregate_id = $2',
      [code, aggregateId],
    );
    return row!;
  }

  describe.each(TENANTS)('%s', (code) => {
    const tenant = () => h.tenant(code);

    it('F1 committed, then the worker dies before calling Flowable: the next lease delivers once', async () => {
      const requestId = await h.submitLeave(code);
      h.engine.dieBefore.add('findInstancesByBusinessKey');
      void h.relay.runOnce(tenant()); // the worker dies at the engine door
      await eventually(() => Promise.resolve(h.engine.died.length === 1), 5_000, 50);
      expect(h.engine.callsTo('startInstance')).toBe(0);

      h.engine.reset();
      await sleep(LEASE_MS + 200);
      await h.converge(code);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(h.engine.callsTo('startInstance')).toBe(1);
      expect(await outboxRow(code, requestId)).toMatchObject({ attempts: 2 });
      record('F1 crash after commit, before Flowable call (start)', {
        tenant: code,
        startCalls: 1,
        ...report,
      });
    });

    it('F2 Flowable started the instance, the worker dies before its ack: adopted, not started again', async () => {
      const requestId = await h.submitLeave(code);
      h.engine.dieAfter.add('startInstance');
      void h.relay.runOnce(tenant());
      await eventually(() => Promise.resolve(h.engine.died.length === 1), 5_000, 50);
      const firstStarts = h.engine.callsTo('startInstance');

      h.engine.reset();
      await sleep(LEASE_MS + 200);
      await h.converge(code);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(report.deletedOrphans).toBe(0);
      expect(firstStarts + h.engine.callsTo('startInstance')).toBe(1);
      expect(await outboxRow(code, requestId)).toMatchObject({ attempts: 2 });
      record('F2 crash after Flowable start, before ack', {
        tenant: code,
        startCalls: firstStarts + h.engine.callsTo('startInstance'),
        ...report,
      });
    });

    it('F3 Flowable completed the task, the worker dies before its ack: recognised by its key', async () => {
      const { requestId, taskId } = await openRequest(code);
      expect(await h.decide(code, 'approver', taskId, 'approve')).toMatchObject({ ok: true });
      h.engine.dieAfter.add('completeTask');
      void h.relay.runOnce(tenant());
      await eventually(() => Promise.resolve(h.engine.died.length === 1), 5_000, 50);

      h.engine.reset();
      // The sync runs first this time: it reads history and closes the task with our key.
      await h.sync.runOnce(tenant());
      await sleep(LEASE_MS + 200);
      await h.converge(code);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(report.requestStatus).toBe('approved');
      expect(h.engine.callsTo('completeTask')).toBe(0); // the relay saw it was already done
      expect(await h.incidents(code)).toEqual([]);
      record('F3 crash after Flowable complete, before ack', { tenant: code, ...report });
    });

    it('F4 Flowable unreachable: commands wait with their error, then go through once', async () => {
      const { requestId: first, taskId } = await openRequest(code);
      expect(await h.decide(code, 'approver', taskId, 'approve')).toMatchObject({ ok: true });
      const second = await h.submitLeave(code);
      h.engine.reset();
      h.engine.down = true;
      for (let pass = 0; pass < 3; pass += 1) {
        expect(await h.relay.runOnce(tenant())).toMatchObject({ delivered: 0, retried: 2 });
        await expect(h.sync.runOnce(tenant())).rejects.toThrow('unavailable');
      }
      expect(await outboxRow(code, second)).toMatchObject({
        attempts: 3,
        published_at: null,
        last_error: 'engine.unreachable',
      });
      h.engine.down = false;
      await h.converge(code);
      for (const requestId of [first, second]) expectCriterion(await h.criterion(code, requestId));
      expect((await h.criterion(code, first)).requestStatus).toBe('approved');
      expect(h.engine.callsTo('startInstance')).toBe(1);
      expect(h.engine.callsTo('completeTask')).toBe(1);
      record('F4 Flowable unreachable then back (in process)', {
        tenant: code,
        attemptsWhileDown: 3,
        first: await h.criterion(code, first),
        second: await h.criterion(code, second),
      });
    });

    it('F5a duplicate delivery core->Flowable: three relays race for five commands', async () => {
      const ids = [];
      for (let index = 0; index < 5; index += 1) ids.push(await h.submitLeave(code));
      const relays = [h.newRelay(), h.newRelay(), h.newRelay()];
      const passes = await Promise.all(relays.map((relay) => relay.runOnce(tenant())));
      expect(passes.reduce((sum, pass) => sum + pass.claimed, 0)).toBe(5);
      expect(h.engine.callsTo('startInstance')).toBe(5);
      await h.converge(code);
      for (const requestId of ids) expectCriterion(await h.criterion(code, requestId));
      record('F5a concurrent relays', {
        tenant: code,
        commands: 5,
        claims: passes.map((p) => p.claimed),
        startCalls: 5,
      });
    });

    it('F5b duplicate delivery core->Flowable: every command redelivered after its ack', async () => {
      const { requestId, taskId } = await openRequest(code);
      expect(await h.decide(code, 'approver', taskId, 'approve')).toMatchObject({ ok: true });
      await h.converge(code);
      h.engine.reset();
      // At-least-once: the relay delivers both commands again (published_at lost).
      await h.sql(
        `UPDATE process.outbox SET published_at = NULL, lease_until = NULL
          WHERE tenant_id = $1 AND aggregate_id IN ($2, $3)`,
        [code, requestId, taskId],
      );
      expect(await h.relay.runOnce(tenant())).toMatchObject({ claimed: 2, delivered: 2 });
      await h.converge(code);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(report.requestStatus).toBe('approved');
      expect(h.engine.callsTo('startInstance')).toBe(0);
      expect(h.engine.callsTo('completeTask')).toBe(0);
      expect(await h.incidents(code)).toEqual([]);
      record('F5b redelivered start and completion', {
        tenant: code,
        startCalls: 0,
        completeCalls: 0,
        ...report,
      });
    });

    it('F5c a lease runs out while a slow worker still holds the command: the second start is an orphan', async () => {
      const requestId = await h.submitLeave(code);
      const slow = new FaultyEngine(h.flowable);
      slow.delayBefore.set('startInstance', LEASE_MS + 1_000);
      const slowRelay = new CommandRelay(h.persistence.unitOfWork, h.store, slow, h.ids, h.clock, {
        leaseMs: LEASE_MS,
        batchSize: 20,
        retryAfterMs: 0,
      });
      const slowPass = slowRelay.runOnce(tenant()); // looks, finds nothing, then stalls
      await sleep(LEASE_MS + 200);
      await h.relay.runOnce(tenant()); // the lease ran out: a second worker starts and acks
      await slowPass; // the slow worker wakes and starts a second instance
      expect((await instancesOf(code, requestId)).length).toBe(2);

      await h.converge(code);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(report.deletedOrphans).toBe(1);
      expect((await h.incidents(code)).map((incident) => incident.kind)).toEqual([
        'orphan-instance',
      ]);
      record('F5c lease expiry overlap -> duplicate start -> orphan removed', {
        tenant: code,
        ...report,
      });
    });

    it('F6 duplicate delivery Flowable->core: repeated and concurrent polls change nothing', async () => {
      const { requestId } = await openRequest(code);
      const inboxBefore = await h.sql<{ count: string }>(
        'SELECT count(*) FROM process.inbox WHERE tenant_id = $1',
        [code],
      );
      const sequential = [];
      for (let pass = 0; pass < 3; pass += 1) sequential.push(await h.sync.runOnce(tenant()));
      const concurrent = await Promise.all(
        [h.newSync(), h.newSync(), h.newSync()].map((s) => s.runOnce(tenant())),
      );
      for (const pass of [...sequential, ...concurrent]) expect(pass.applied).toBe(0);
      expect(concurrent.every((pass) => pass.duplicates > 0)).toBe(true);
      const inboxAfter = await h.sql<{ count: string }>(
        'SELECT count(*) FROM process.inbox WHERE tenant_id = $1',
        [code],
      );
      expect(inboxAfter).toEqual(inboxBefore);
      expectCriterion(await h.criterion(code, requestId));
      record('F6 repeated and concurrent observations', {
        tenant: code,
        passes: 6,
        applied: 0,
        duplicatesPerPass: [...sequential, ...concurrent].map((pass) => pass.duplicates),
        inboxRows: Number(inboxAfter[0]!.count),
      });
    });

    it('F6b two syncs apply the same new task at the same moment: one row, one inbox entry', async () => {
      const requestId = await h.submitLeave(code);
      await h.relay.runOnce(tenant());
      const passes = await Promise.all(
        [h.newSync(), h.newSync(), h.newSync()].map((s) => s.runOnce(tenant())),
      );
      expect(passes.reduce((sum, pass) => sum + pass.applied, 0)).toBe(1);
      expectCriterion(await h.criterion(code, requestId));
      record('F6b concurrent first observation', {
        tenant: code,
        applied: passes.map((p) => p.applied),
      });
    });

    it('F7a the deadline passes while the core bridge is down: escalation is picked up', async () => {
      h.escalateAfterSeconds = 3;
      const { requestId, taskId } = await openRequest(code);
      await sleep(7_000); // no relay, no sync: the core bridge is down; Flowable's timer fires
      await h.converge(code);
      const [old] = await h.sql<{ status: string }>(
        'SELECT status FROM process.task WHERE tenant_id = $1 AND id = $2',
        [code, taskId],
      );
      expect(old!.status).toBe('escalated');
      const managerTasks = await h.inboxOf(code, 'manager');
      expect(managerTasks.filter((entry) => entry.requestId === requestId)).toHaveLength(1);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      record('F7a timer fired during core outage', { tenant: code, ...report });
    });

    it('F7b the approver task opens and escalates while the sync is down: recorded from history', async () => {
      h.escalateAfterSeconds = 2;
      const requestId = await h.submitLeave(code);
      await h.relay.runOnce(tenant()); // started; the sync is down from here
      await sleep(6_000);
      await h.converge(code);
      const tasks = await h.sql<{ task_key: string; status: string }>(
        'SELECT task_key, status FROM process.task WHERE tenant_id = $1 AND request_id = $2 ORDER BY task_key',
        [code, requestId],
      );
      expect(tasks).toEqual([
        { task_key: 'approve', status: 'escalated' },
        { task_key: 'approveEscalated', status: 'open' },
      ]);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      record('F7b task opened and escalated during core outage (backfill)', {
        tenant: code,
        ...report,
      });
    });

    it('F7c the approver decides, Flowable is unreachable, the deadline wins: superseded, never lost', async () => {
      h.escalateAfterSeconds = 4;
      const { requestId, taskId } = await openRequest(code);
      h.engine.down = true;
      expect(await h.decide(code, 'approver', taskId, 'approve')).toMatchObject({ ok: true });
      await h.relay.runOnce(tenant()); // fails: unreachable
      await sleep(7_000); // the deadline passes in Flowable
      h.engine.down = false;
      await h.converge(code);
      const [task] = await h.sql<{ status: string; decision: string }>(
        'SELECT status, decision FROM process.task WHERE tenant_id = $1 AND id = $2',
        [code, taskId],
      );
      expect(task).toEqual({ status: 'superseded', decision: 'approve' });
      const managerTasks = await h.inboxOf(code, 'manager');
      expect(managerTasks.filter((entry) => entry.requestId === requestId)).toHaveLength(1);
      expect((await h.incidents(code)).map((incident) => incident.kind)).toEqual([
        'completion-superseded',
      ]);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      record('F7c core decision vs deadline during Flowable outage', {
        tenant: code,
        task,
        ...report,
      });
    });

    it('F10 a task completed in Flowable directly is closed and reported, not trusted', async () => {
      const { requestId, taskId } = await openRequest(code);
      const [engineTask] = await h.sql<{ engine_task_id: string }>(
        'SELECT engine_task_id FROM process.task WHERE tenant_id = $1 AND id = $2',
        [code, taskId],
      );
      const direct = await flowableRest('POST', `/runtime/tasks/${engineTask!.engine_task_id}`, {
        action: 'complete',
        variables: [{ name: 'decision', value: 'approve' }],
      });
      expect(direct.status).toBe(200);
      await h.converge(code);
      expect((await h.incidents(code)).map((incident) => incident.kind)).toEqual([
        'completed-outside-core',
      ]);
      expectCriterion(await h.criterion(code, requestId));
      record('F10 completed outside the core', {
        tenant: code,
        incident: 'completed-outside-core',
      });
    });
  });

  describe('tenant isolation in and around Flowable', () => {
    it('F9 every engine object carries tenant_id and the adapter refuses another tenant', async () => {
      const fa = await openRequest('demo-fa');
      const en = await openRequest('demo-en');
      const [enTask] = await h.sql<{ engine_task_id: string }>(
        'SELECT engine_task_id FROM process.task WHERE tenant_id = $1 AND id = $2',
        ['demo-en', en.taskId],
      );
      const engineTaskId = enTask!.engine_task_id;
      // Reading through the wrong tenant finds nothing; acting on it is refused.
      expect(await h.flowable.findTask(h.tenant('demo-fa'), engineTaskId)).toBeNull();
      await expect(
        h.flowable.completeTask(h.tenant('demo-fa'), engineTaskId, 'approve', h.ids.next()),
      ).rejects.toBeInstanceOf(EngineTenantMismatchError);
      expect((await h.flowable.findTask(h.tenant('demo-en'), engineTaskId))?.end).toBeNull();

      // Flowable REST ignores parameters it does not know: a misspelt filter returns everything.
      const misspelt = await flowableRest('GET', '/runtime/tasks?tenantID=demo-fa&size=500');
      const tenantsSeen = new Set(
        (misspelt.json as { data: { tenantId: string }[] }).data.map((t) => t.tenantId),
      );
      const unknownKey = await flowableRest(
        'GET',
        '/history/historic-process-instances?processInstanceBusinessKey=no-such-key&size=1',
      );
      expect(tenantsSeen.has('demo-en')).toBe(true);
      expect((unknownKey.json as { total: number }).total).toBeGreaterThan(0);

      const rows = await flowableSql<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id_'
            AND table_name IN ('act_ru_execution', 'act_ru_task', 'act_ru_timer_job', 'act_hi_procinst', 'act_hi_taskinst')
          ORDER BY table_name`,
      );
      const perTenant = await flowableSql<{ tenant_id_: string; count: string }>(
        `SELECT tenant_id_, count(*) FROM act_ru_task WHERE tenant_id_ IN ('demo-fa', 'demo-en') GROUP BY 1 ORDER BY 1`,
      );
      expect(rows.map((row) => row.table_name)).toHaveLength(5);
      record('F9 tenant isolation', {
        faRequest: fa.requestId,
        enRequest: en.requestId,
        crossTenantRead: 'null',
        crossTenantComplete: 'EngineTenantMismatchError',
        misspeltFilterTenantsSeen: [...tenantsSeen].sort(),
        unknownParamTotal: (unknownKey.json as { total: number }).total,
        tenantColumns: rows.map((row) => row.table_name),
        openTasksPerTenant: perTenant,
      });
    });

    it('F12 Flowable has its own database and role; neither side can reach the other', async () => {
      const intoFlowable = new URL(testDatabaseUrl());
      intoFlowable.pathname = '/flowable';
      const core = new Client({ connectionString: intoFlowable.toString() });
      await expect(core.connect()).rejects.toThrow(/permission denied for database "flowable"/);
      const intoCore = new URL(FLOWABLE_DATABASE_URL);
      intoCore.pathname = new URL(testDatabaseUrl()).pathname;
      const engine = new Client({ connectionString: intoCore.toString() });
      await expect(engine.connect()).rejects.toThrow(/permission denied for database/);
      const tables = await flowableSql<{ count: string }>(
        `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'act\\_%'`,
      );
      record('F12 database placement', {
        flowableTables: Number(tables[0]!.count),
        coreToFlowable: 'denied',
        flowableToCore: 'denied',
      });
    });

    it('F11 a unique index on (tenant, business key) in Flowable history refuses a second start', async () => {
      const tenant = h.tenant('demo-fa');
      const [revision] = await h.sql<{ id: string }>(
        `SELECT id FROM process.process_revision WHERE tenant_id = 'demo-fa' ORDER BY revision DESC LIMIT 1`,
      );
      const start = (businessKey: string) =>
        h.flowable.startInstance(tenant, {
          processKey: 'leave-approval',
          revisionId: revision!.id,
          businessKey,
          variables: {
            requestId: businessKey,
            approverId: h.ids.next(),
            managerId: h.ids.next(),
            escalateAfter: 'PT1H',
          },
        });
      const live = async (key: string) =>
        (await instancesOf('demo-fa', key)).filter((row) => row.deleteReason == null);
      const without = h.ids.next();
      const racedWithout = await Promise.allSettled([start(without), start(without)]);
      const duplicates = await live(without);
      expect(duplicates).toHaveLength(2);
      // The index cannot be created over existing duplicates: remove them first (an install
      // creates it on an empty database).
      for (const row of duplicates) {
        await flowableRest(
          'DELETE',
          `/runtime/process-instances/${row.id}?deleteReason=test-reset`,
        );
      }
      await flowableSql(
        `CREATE UNIQUE INDEX phoenix_hi_procinst_business_key ON act_hi_procinst (tenant_id_, business_key_)
          WHERE business_key_ IS NOT NULL AND delete_reason_ IS NULL`,
      );
      try {
        const withIndex = h.ids.next();
        const racedWith = await Promise.allSettled([start(withIndex), start(withIndex)]);
        expect(await live(withIndex)).toHaveLength(1);
        const rejected = racedWith.filter((result) => result.status === 'rejected');
        expect(rejected).toHaveLength(1);
        // The losing start fails as a server error, which the relay retries; the retry then
        // finds the winner by business key and adopts it.
        expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain('server-error');
        record('F11 unique business key index in Flowable DB', {
          withoutIndex: {
            fulfilled: racedWithout.filter((r) => r.status === 'fulfilled').length,
            live: 2,
          },
          withIndex: { fulfilled: 1, rejected: 1, live: 1 },
        });
      } finally {
        await flowableSql('DROP INDEX IF EXISTS phoenix_hi_procinst_business_key');
      }
    });
  });
});
