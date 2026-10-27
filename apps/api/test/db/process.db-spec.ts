import { encodeAuditFields, Temporal } from '@phoenix/shared-kernel';
import type { AuditEntry, CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import {
  FixedClock,
  SequenceIdGenerator,
  testAuthenticatedActor,
  testCallContext,
} from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { AuditWriter } from '../../src/platform/audit/audit-writer';
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { CommandRelay } from '../../src/modules/process/application/bridge/command-relay';
import { EngineSync } from '../../src/modules/process/application/bridge/engine-sync';
import { EngineCommands } from '../../src/modules/process/application/engine-commands';
import type { TaskRecord } from '../../src/modules/process/application/process.repository';
import { ListProcessIncidents } from '../../src/modules/process/application/use-cases/list-process-incidents.use-case';
import { PublishProcessRevision } from '../../src/modules/process/application/use-cases/publish-process-revision.use-case';
import { StartProcessInstance } from '../../src/modules/process/application/use-cases/start-process-instance.use-case';
import { PROCESS_PERMISSIONS } from '../../src/modules/process/contracts/permissions';
import { PROCESS_AUDIT_ACTIONS } from '../../src/modules/process/domain/audit-actions';
import { COMMAND_LEASE_MS } from '../../src/modules/process/domain/engine-command';
import { NodeBridgeHashing } from '../../src/modules/process/infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from '../../src/modules/process/infrastructure/prisma-process.repository';
import { CallLostError, FakeProcessEngine } from '../support/fake-process-engine';
import { realFlowableScenarios } from './process-flowable.scenarios';
import { TEST_TENANT_CONFIG_DIRS, TEST_TENANTS, testTenantId } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { testDatabaseUrl } from './test-database';

// Phase 2 slice 2.2: the process bridge end to end against PostgreSQL, through the real
// repository, UnitOfWork, tenant guard and row-level security, with an in-memory engine that
// behaves as Flowable did in PoC 3 (the adapter has its own tests against scripted HTTP). Each
// scenario is a row of the PoC 3 failure matrix: the criterion is that every engine task of the
// adopted instance is in the core exactly once, no orphan's task ever is, and every anomaly is
// an incident. The gate admits a staff actor; the audit writer checks each entry.

const DEFINITIONS = new Map(PROCESS_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(_context: CallContext, entry: AuditEntry): Promise<void> {
    const definition = DEFINITIONS.get(entry.action);
    if (definition === undefined) throw new Error(`undeclared audit action ${entry.action}`);
    const options = { isKnownPermissionKey: () => false };
    if (definition.after !== null) {
      expect(encodeAuditFields(definition.after, entry.after, options).ok).toBe(true);
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
}

const bpmn = (key: string) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" isExecutable="true">
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
    <userTask id="approve" flowable:formKey="decision"/>
    <sequenceFlow id="f2" sourceRef="approve" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;

describe.each(TEST_TENANTS)('the process bridge in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  // A clock per tenant, so the two runs never mint the same ids into the shared database.
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-28T08:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  const engine = new FakeProcessEngine(clock);
  const system = testCallContext(tenant, 'system');
  const staff = (of: TenantContext): CallContext =>
    testCallContext(
      of,
      testAuthenticatedActor(of, {
        population: 'tenant-staff',
        accountId: ids.next<'Account'>(),
        sessionId: ids.next<'Session'>(),
      }),
    );
  let persistence: Persistence;
  let reader: Client;
  let bridge: ReturnType<typeof build>;
  let keys = 0;

  function build(p: Persistence) {
    const declared = new Map<string, PermissionDeclaration>(
      PROCESS_PERMISSIONS.declarations.map((d) => [d.key, d]),
    );
    const tenants = new TenantRegistry(
      loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANTS.map(testTenantId)),
    );
    const gate = createUseCaseGate(
      tenants,
      { get: (key) => declared.get(key) },
      { check: () => Promise.resolve({ allowed: true }) },
    );
    const uow = p.unitOfWork;
    const repository = new PrismaProcessRepository(p.service);
    const hashing = new NodeBridgeHashing();
    const commands = new EngineCommands(repository, ids, clock);
    return {
      uow,
      repository,
      commands,
      relay: new CommandRelay(uow, repository, commands, engine, ids, clock),
      sync: new EngineSync(uow, repository, commands, engine, hashing, ids, clock),
      publish: new PublishProcessRevision(
        gate,
        uow,
        repository,
        commands,
        hashing,
        audit,
        clock,
        ids,
      ),
      start: new StartProcessInstance(gate, uow, repository, commands, clock, ids),
      incidents: new ListProcessIncidents(gate, uow, repository),
    };
  }

  beforeAll(async () => {
    persistence = createPersistence();
    reader = new Client({ connectionString: testDatabaseUrl() });
    await reader.connect();
    bridge = build(persistence);
  });

  afterAll(async () => {
    await reader.end();
    await persistence.close();
  });

  /** Rows of `of` as the application login sees them under row-level security. */
  async function rowsOf<R extends object>(of: TenantContext, sql: string, params: unknown[] = []) {
    await reader.query('BEGIN');
    try {
      await reader.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [of.tenantId]);
      return (await reader.query<R>(sql, params)).rows;
    } finally {
      await reader.query('ROLLBACK');
    }
  }

  const relay = () => bridge.relay.runOnce(system);
  const sync = () => bridge.sync.runOnce(system);
  /** Relays until nothing is due, moving the clock past any retry. */
  async function drain(): Promise<void> {
    for (let pass = 0; pass < 10; pass += 1) {
      const { claimed } = await relay();
      if (claimed === 0) {
        const due = await rowsOf<{ n: string }>(
          tenant,
          'SELECT count(*) AS n FROM process.engine_command WHERE published_at IS NULL AND dead_at IS NULL',
        );
        if (due[0]!.n === '0') return;
        clock.advance(Temporal.Duration.from({ minutes: 6 }));
      }
    }
    throw new Error('the relay did not drain');
  }

  async function published(): Promise<Id<'ProcessRevision'>> {
    const key = `leave-${code.replace('-', '_')}-${++keys}`;
    const result = await bridge.publish.execute(staff(tenant), {
      processKey: key,
      bpmnXml: bpmn(key),
    });
    if (!result.ok) throw new Error(`setup: ${result.error.code}`);
    return result.value.id;
  }

  async function started(): Promise<Id<'ProcessInstance'>> {
    return startOf(await published());
  }

  async function startOf(revisionId: Id<'ProcessRevision'>): Promise<Id<'ProcessInstance'>> {
    const result = await bridge.start.execute(system, { revisionId, variables: { days: 3 } });
    if (!result.ok) throw new Error(`setup: ${result.error.code}`);
    return result.value.id;
  }

  const instanceRow = async (id: string) =>
    (
      await rowsOf<{ status: string; engine_instance_id: string | null }>(
        tenant,
        'SELECT status, engine_instance_id FROM process.process_instance WHERE id = $1',
        [id],
      )
    )[0]!;
  const tasksOf = (instanceId: string) =>
    rowsOf<{ id: string; engine_task_id: string; task_key: string; status: string }>(
      tenant,
      'SELECT id, engine_task_id, task_key, status FROM process.process_task WHERE instance_id = $1 ORDER BY opened_at, id',
      [instanceId],
    );
  const incidentsAbout = (ref: string) =>
    rowsOf<{ kind: string; instance_id: string | null }>(
      tenant,
      'SELECT kind, instance_id FROM process.process_incident WHERE engine_ref = $1',
      [ref],
    );
  async function taskRecord(id: string): Promise<TaskRecord> {
    const found = await bridge.uow.run(
      tenant,
      async () => ({ ok: true as const, value: await bridge.repository.findTask(tenant, id) }),
      { readOnly: true },
    );
    if (!found.ok || found.value === null) throw new Error('no task');
    return found.value;
  }
  async function requestCompletion(taskId: string): Promise<string> {
    const task = await taskRecord(taskId);
    const done = await bridge.uow.run(tenant, async () => ({
      ok: true as const,
      value: await bridge.commands.completeTask(system, task, { outcome: 'approve' }),
    }));
    expect(done).toEqual({ ok: true, value: true });
    return (await taskRecord(taskId)).completionKey!;
  }

  /** PoC 3's criterion for one instance. */
  async function expectCriterion(instanceId: string): Promise<void> {
    const row = await instanceRow(instanceId);
    const live = engine.liveInstancesOf(instanceId);
    if (row.status === 'running') expect(live.map((i) => i.id)).toEqual([row.engine_instance_id]);
    else expect(live).toEqual([]);
    const engineTasks = engine.tasks.filter((t) => t.instanceId === row.engine_instance_id);
    const coreTasks = await tasksOf(instanceId);
    expect(coreTasks.map((t) => t.engine_task_id).sort()).toEqual(
      engineTasks.map((t) => t.id).sort(),
    );
    const open = coreTasks.filter((t) => t.status === 'open' || t.status === 'completing');
    expect(open.map((t) => t.engine_task_id).sort()).toEqual(
      engineTasks
        .filter((t) => t.endedAt === null)
        .map((t) => t.id)
        .sort(),
    );
  }

  describe('publishing (D7, slice 2.2 security)', () => {
    it('stores numbered immutable revisions, audits them and deploys each under the tenant', async () => {
      const key = `publish-${code.replace('-', '_')}`;
      const first = await bridge.publish.execute(staff(tenant), {
        processKey: key,
        bpmnXml: bpmn(key),
      });
      const second = await bridge.publish.execute(staff(tenant), {
        processKey: key,
        bpmnXml: bpmn(key),
      });
      expect(first).toMatchObject({ ok: true, value: { revision: 1 } });
      expect(second).toMatchObject({ ok: true, value: { revision: 2 } });
      expect(audit.entries.at(-1)).toMatchObject({
        action: 'process.revision.published',
        after: { revision: 2 },
      });
      const [row] = await rowsOf<{ content_hash: string }>(
        tenant,
        'SELECT content_hash FROM process.process_revision WHERE id = $1',
        [second.ok ? second.value.id : null],
      );
      expect(row!.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);

      await drain();
      const revisionId = second.ok ? second.value.id : '';
      expect(engine.deployments.get(`${code}/${key}@${revisionId}`)).toBe(code);
    });

    it('refuses a model that would run code in the shared engine, and stores nothing', async () => {
      const key = 'evil';
      const xml = bpmn(key).replace(
        '<userTask id="approve" flowable:formKey="decision"/>',
        '<scriptTask id="approve" scriptFormat="groovy"><script>System.exit(0)</script></scriptTask>',
      );
      expect(
        await bridge.publish.execute(staff(tenant), { processKey: key, bpmnXml: xml }),
      ).toEqual({
        ok: false,
        error: { code: 'process.bpmn.forbidden-construct', field: 'scriptTask' },
      });
      expect(
        await rowsOf(tenant, 'SELECT 1 FROM process.process_revision WHERE process_key = $1', [
          key,
        ]),
      ).toEqual([]);
    });

    it("never starts another tenant's revision", async () => {
      const revisionId = await published();
      expect(
        await bridge.start.execute(testCallContext(other, 'system'), { revisionId, variables: {} }),
      ).toEqual({ ok: false, error: { code: 'process.revision.not-found' } });
    });

    it('refuses variables that are not ids, codes or numbers (ADR-0005 decision 7)', async () => {
      const revisionId = await published();
      expect(
        await bridge.start.execute(system, { revisionId, variables: { note: 'free text here' } }),
      ).toEqual({ ok: false, error: { code: 'process.variable.invalid', field: 'note' } });
    });
  });

  describe('the happy path', () => {
    it('starts, surfaces the task, completes it with the key and closes the instance', async () => {
      const instanceId = await started();
      expect((await instanceRow(instanceId)).status).toBe('starting');
      await drain();
      const adopted = await instanceRow(instanceId);
      expect(adopted.status).toBe('running');
      expect(engine.liveInstancesOf(instanceId)).toHaveLength(1);

      await sync();
      const [task] = await tasksOf(instanceId);
      expect(task).toMatchObject({ task_key: 'approve', status: 'open' });

      const key = await requestCompletion(task!.id);
      await drain();
      expect((await tasksOf(instanceId))[0]!.status).toBe('completed');
      const engineTask = engine.tasks.find((t) => t.id === task!.engine_task_id)!;
      expect(engineTask.completionKey).toBe(key);
      expect(engineTask.completedWith).toEqual({ outcome: 'approve' });

      clock.advance(Temporal.Duration.from({ seconds: 1 }));
      engine.endInstance(adopted.engine_instance_id!);
      await sync();
      expect((await instanceRow(instanceId)).status).toBe('completed');
      expect(await incidentsAbout(task!.engine_task_id)).toEqual([]);
      await expectCriterion(instanceId);
    });

    it('changes nothing when the same engine state is read again (inbox dedup, F6)', async () => {
      const instanceId = await started();
      await drain();
      await sync();
      const before = await tasksOf(instanceId);
      const again = await Promise.all([sync(), sync(), sync()]);
      expect(again.map((pass) => pass.applied)).toEqual([0, 0, 0]);
      expect(await tasksOf(instanceId)).toEqual(before);
      await expectCriterion(instanceId);
    });
  });

  describe('core to engine, at least once (R2, R3)', () => {
    it('adopts the instance a lost start answer created, without starting again (F2)', async () => {
      const revisionId = await published();
      await drain();
      const instanceId = await startOf(revisionId);
      engine.loseAnswerOf = 'startInstance';
      await expect(relay()).rejects.toBeInstanceOf(CallLostError);
      expect((await instanceRow(instanceId)).status).toBe('starting');
      const startsBefore = engine.calls.filter((c) => c === 'startInstance').length;

      await drain();
      expect(engine.calls.filter((c) => c === 'startInstance').length).toBe(startsBefore);
      expect((await instanceRow(instanceId)).status).toBe('running');
      expect(await incidentsAbout(engine.liveInstancesOf(instanceId)[0]!.id)).toEqual([]);
      await sync();
      await expectCriterion(instanceId);
    });

    it('holds a claimed command for its lease, then lets another relay deliver it (F1)', async () => {
      const revisionId = await published();
      await drain();
      const instanceId = await startOf(revisionId);
      // A relay claims the start and dies at the engine's door: nothing is released.
      const [command] = await rowsOf<{ id: string; attempts: number }>(
        tenant,
        "SELECT id, attempts FROM process.engine_command WHERE subject_id = $1 AND kind = 'start-instance'",
        [instanceId],
      );
      await bridge.uow.run(tenant, async () => ({
        ok: true as const,
        value: await bridge.repository.claimCommand(
          tenant,
          {
            id: command!.id as Id<'EngineCommand'>,
            kind: 'start-instance',
            subjectId: instanceId,
            payload: {},
            correlationId: 'test-correlation-0001',
            attempts: command!.attempts,
          },
          clock.now().add({ milliseconds: COMMAND_LEASE_MS }),
        ),
      }));
      expect(await relay()).toMatchObject({ claimed: 0 });
      clock.advance(Temporal.Duration.from({ milliseconds: COMMAND_LEASE_MS - 1 }));
      expect(await relay()).toMatchObject({ claimed: 0 });
      expect((await instanceRow(instanceId)).status).toBe('starting');

      clock.advance(Temporal.Duration.from({ milliseconds: 1 }));
      expect(await relay()).toMatchObject({ claimed: 1, delivered: 1 });
      expect((await instanceRow(instanceId)).status).toBe('running');
      const [after] = await rowsOf<{ attempts: number }>(
        tenant,
        'SELECT attempts FROM process.engine_command WHERE id = $1',
        [command!.id],
      );
      expect(after!.attempts).toBe(2);
      await sync();
      await expectCriterion(instanceId);
    });

    it('adopts the first of two instances and removes the orphan with an incident (F5c)', async () => {
      const instanceId = await started();
      // Two relays raced past the lease: both instances exist before any ack.
      const revisionId = (
        await rowsOf<{ revision_id: string }>(
          tenant,
          'SELECT revision_id FROM process.process_instance WHERE id = $1',
          [instanceId],
        )
      )[0]!.revision_id;
      expect(revisionId).toBeDefined();
      const first = engine.startDuplicate(code, instanceId);
      clock.advance(Temporal.Duration.from({ milliseconds: 1 }));
      const second = engine.startDuplicate(code, instanceId);
      await drain();

      expect((await instanceRow(instanceId)).engine_instance_id).toBe(first);
      expect(await incidentsAbout(second)).toEqual([
        { kind: 'orphan-instance', instance_id: instanceId },
      ]);
      expect(engine.liveInstancesOf(instanceId).map((i) => i.id)).toEqual([first]);
      await sync();
      await expectCriterion(instanceId);
    });

    it('flags and removes an orphan that appears after the adoption, never surfacing its task', async () => {
      const instanceId = await started();
      await drain();
      const orphan = engine.startDuplicate(code, instanceId);
      await sync();
      await drain();
      expect(await incidentsAbout(orphan)).toEqual([
        { kind: 'orphan-instance', instance_id: instanceId },
      ]);
      expect(engine.liveInstancesOf(instanceId)).toHaveLength(1);
      await sync();
      await expectCriterion(instanceId);
    });

    it('waits with a back-off while the engine is down, and delivers once it is back (F4)', async () => {
      const instanceId = await started();
      engine.down = true;
      try {
        const pass = await relay();
        expect(pass.delivered).toBe(0);
        expect(pass.retried).toBeGreaterThan(0);
        await expect(sync()).rejects.toThrow('unavailable');
        const [command] = await rowsOf<{ attempts: number; last_error: string; not_before: Date }>(
          tenant,
          "SELECT attempts, last_error, not_before FROM process.engine_command WHERE subject_id = $1 AND kind = 'start-instance'",
          [instanceId],
        );
        expect(command).toMatchObject({ attempts: 1, last_error: 'engine.unreachable' });
        expect(command!.not_before.getTime()).toBe(clock.now().epochMilliseconds + 5000);
      } finally {
        engine.down = false;
      }
      await drain();
      await sync();
      expect((await instanceRow(instanceId)).status).toBe('running');
      await expectCriterion(instanceId);
    });

    it('ends a command the engine refuses for good with an incident', async () => {
      engine.refuseDeployments = true;
      let revisionId: string;
      try {
        revisionId = await published();
        await drain();
      } finally {
        engine.refuseDeployments = false;
      }
      const [command] = await rowsOf<{ id: string; dead_at: Date | null; last_error: string }>(
        tenant,
        "SELECT id, dead_at, last_error FROM process.engine_command WHERE subject_id = $1 AND kind = 'deploy-revision'",
        [revisionId],
      );
      expect(command!.dead_at).not.toBeNull();
      expect(command!.last_error).toBe('engine.client-error');
      expect(await incidentsAbout(command!.id)).toEqual([
        { kind: 'command-refused', instance_id: null },
      ]);
    });

    it('never deploys a stored model the current intake check refuses (security review C1)', async () => {
      // A revision stored before a stricter check: the relay checks it again before the engine.
      const key = `leave-${code.replace('-', '_')}-${++keys}`;
      const unsafe = bpmn(key).replace(
        '<sequenceFlow id="f2" sourceRef="approve" targetRef="end"/>',
        '<sequenceFlow id="f2" sourceRef="approve" targetRef="end"><conditionExpression>$<![CDATA[{execution.getEngineServices()}]]></conditionExpression></sequenceFlow>',
      );
      const revisionId = ids.next<'ProcessRevision'>();
      await persistence.unitOfWork.run(tenant, async () => {
        await bridge.repository.insertRevision(
          tenant,
          {
            id: revisionId,
            processKey: key,
            revision: 1,
            bpmnXml: unsafe,
            contentHash: new NodeBridgeHashing().contentHash(unsafe),
          },
          clock.now(),
        );
        await bridge.commands.deployRevision(system, { id: revisionId });
        return { ok: true as const, value: undefined };
      });
      engine.calls.length = 0;
      await drain();
      expect(engine.calls).not.toContain('deployRevision');
      const [command] = await rowsOf<{ id: string; last_error: string }>(
        tenant,
        "SELECT id, last_error FROM process.engine_command WHERE subject_id = $1 AND kind = 'deploy-revision'",
        [revisionId],
      );
      expect(command!.last_error).toBe('engine.model-refused');
      expect(await incidentsAbout(command!.id)).toEqual([
        { kind: 'command-refused', instance_id: null },
      ]);
    });
  });

  describe('completion keys (R4, R7, R10)', () => {
    it('recognises its own completion when the answer was lost (F3, O4)', async () => {
      const instanceId = await started();
      await drain();
      await sync();
      const [task] = await tasksOf(instanceId);
      await requestCompletion(task!.id);
      engine.loseAnswerOf = 'completeTask';
      await expect(relay()).rejects.toBeInstanceOf(CallLostError);
      expect((await tasksOf(instanceId))[0]!.status).toBe('completing');

      await drain();
      expect((await tasksOf(instanceId))[0]!.status).toBe('completed');
      expect(await incidentsAbout(task!.engine_task_id)).toEqual([]);
      await sync();
      await expectCriterion(instanceId);
    });

    it('marks the completion superseded when the deadline won (F7c), and surfaces the escalation', async () => {
      const instanceId = await started();
      await drain();
      await sync();
      const [task] = await tasksOf(instanceId);
      await requestCompletion(task!.id);
      clock.advance(Temporal.Duration.from({ seconds: 1 }));
      engine.fireTimer(task!.engine_task_id);
      await drain();
      await sync();

      const tasks = await tasksOf(instanceId);
      expect(tasks.map((t) => [t.task_key, t.status])).toEqual([
        ['approve', 'superseded'],
        ['escalate', 'open'],
      ]);
      expect(await incidentsAbout(task!.engine_task_id)).toEqual([
        { kind: 'completion-superseded', instance_id: instanceId },
      ]);
      await expectCriterion(instanceId);
    });

    it('closes a task completed in the engine directly, with an incident (F10)', async () => {
      const instanceId = await started();
      await drain();
      await sync();
      const [task] = await tasksOf(instanceId);
      clock.advance(Temporal.Duration.from({ seconds: 1 }));
      engine.completeBehindTheCore(task!.engine_task_id);
      await sync();
      expect((await tasksOf(instanceId))[0]!.status).toBe('completed');
      expect(await incidentsAbout(task!.engine_task_id)).toEqual([
        { kind: 'completed-outside-core', instance_id: instanceId },
      ]);
      await expectCriterion(instanceId);
    });

    it('refuses a second completion request for the same task', async () => {
      const instanceId = await started();
      await drain();
      await sync();
      const [task] = await tasksOf(instanceId);
      await requestCompletion(task!.id);
      const again = await bridge.uow.run(tenant, async () => ({
        ok: true as const,
        value: await bridge.commands.completeTask(system, await taskRecordIn(task!.id), {}),
      }));
      expect(again).toEqual({ ok: true, value: false });
      await drain();
    });

    async function taskRecordIn(id: string): Promise<TaskRecord> {
      return (await bridge.repository.findTask(tenant, id))!;
    }
  });

  describe('engine to core with watermarks (R5, F7)', () => {
    it('backfills a task that opened and ended between two passes (F7b)', async () => {
      const instanceId = await started();
      await drain();
      // The core is down: the approver's task opens and escalates unseen.
      const approve = engine
        .openTasksOf(code)
        .find((t) => t.instanceId === engine.liveInstancesOf(instanceId)[0]!.id)!;
      clock.advance(Temporal.Duration.from({ minutes: 2 }));
      engine.fireTimer(approve.id);
      await sync();

      const tasks = (await tasksOf(instanceId)).map((t) => [t.task_key, t.status]);
      expect(tasks.sort()).toEqual([
        ['approve', 'escalated'],
        ['escalate', 'open'],
      ]);
      await expectCriterion(instanceId);
    });

    it('saves the watermarks and reads past them on the next pass', async () => {
      await sync();
      const [state] = await rowsOf<{ tasks_ended_after: Date | null; version: number }>(
        tenant,
        'SELECT tasks_ended_after, version FROM process.engine_sync_state',
      );
      expect(state!.tasks_ended_after).not.toBeNull();
      const latestEnd = Math.max(
        ...engine.tasks
          .filter((t) => t.tenantId === code && t.endedAt !== null)
          .map((t) => t.endedAt!.epochMilliseconds),
      );
      expect(state!.tasks_ended_after!.getTime()).toBe(latestEnd);

      engine.foundTasks.length = 0;
      expect((await sync()).applied).toBe(0);
      // Open core rows another suite left in this tenant are unknown to this engine and read
      // from history; none of this engine's ended tasks is read again.
      const ownTasks = new Set(engine.tasks.map((t) => t.id));
      expect(engine.foundTasks.filter((id) => ownTasks.has(id))).toEqual([]);
    });

    it('flags an engine instance no core instance knows, once', async () => {
      const stranger = engine.startDuplicate(code, `outside-${code}`);
      await sync();
      await sync();
      expect(await incidentsAbout(stranger)).toEqual([
        { kind: 'unknown-instance', instance_id: null },
      ]);
      engine.endInstance(stranger, 'cleanup');
    });
  });

  describe('isolation and incidents (ADR-0002, R8)', () => {
    it("lists the tenant's incidents newest first, and none of them to the other tenant", async () => {
      const mine = await bridge.incidents.execute(staff(tenant), { limit: 100 });
      expect(mine.ok && mine.value.length).toBeGreaterThan(0);
      if (mine.ok) {
        const times = mine.value.map((incident) => incident.detectedAt.epochMilliseconds);
        expect([...times].sort((a, b) => b - a)).toEqual(times);
      }
      const theirs = await bridge.incidents.execute(staff(other), { limit: 100 });
      const mineIds = new Set(mine.ok ? mine.value.map((incident) => incident.id) : []);
      expect(theirs.ok && theirs.value.some((incident) => mineIds.has(incident.id))).toBe(false);
    });

    it('shows no process row of this tenant to the other tenant', async () => {
      for (const table of [
        'process_revision',
        'process_instance',
        'process_task',
        'engine_command',
        'engine_observation',
        'engine_sync_state',
        'process_incident',
      ]) {
        const rows = await rowsOf<{ tenant_id: string }>(
          other,
          `SELECT DISTINCT tenant_id FROM process.${table}`,
        );
        expect(rows.map((row) => row.tenant_id)).not.toContain(code);
      }
    });

    it('never touches the other tenant through the engine', () => {
      const otherTenant = otherTenantOf(code);
      for (const instance of engine.instances) expect(instance.tenantId).not.toBe(otherTenant);
      for (const task of engine.tasks) expect(task.tenantId).not.toBe(otherTenant);
    });
  });
});

// The same bridge on the real engine, after the fake engine's scenarios (see that file).
realFlowableScenarios();
