import { Temporal } from '@phoenix/shared-kernel';
import type { CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import {
  FixedClock,
  SequenceIdGenerator,
  testAuthenticatedActor,
  testCallContext,
} from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { RoleHolding, RoleHoldingReader, SiteAncestryReader } from '../../src/platform/authz';
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
import { CommandRelay } from '../../src/modules/process/application/bridge/command-relay';
import { EngineSync } from '../../src/modules/process/application/bridge/engine-sync';
import { EngineCommands } from '../../src/modules/process/application/engine-commands';
import { TaskInbox } from '../../src/modules/process/application/task-inbox';
import { AssignTask } from '../../src/modules/process/application/use-cases/assign-task.use-case';
import { ClaimTask } from '../../src/modules/process/application/use-cases/claim-task.use-case';
import { CompleteTask } from '../../src/modules/process/application/use-cases/complete-task.use-case';
import { EscalateOverdueTasks } from '../../src/modules/process/application/use-cases/escalate-overdue-tasks.use-case';
import { ListMyTasks } from '../../src/modules/process/application/use-cases/list-my-tasks.use-case';
import { ListSiteTasks } from '../../src/modules/process/application/use-cases/list-site-tasks.use-case';
import { PublishProcessRevision } from '../../src/modules/process/application/use-cases/publish-process-revision.use-case';
import { ReleaseTask } from '../../src/modules/process/application/use-cases/release-task.use-case';
import { ReplaceWorkingCalendar } from '../../src/modules/process/application/use-cases/replace-working-calendar.use-case';
import { StartProcessInstance } from '../../src/modules/process/application/use-cases/start-process-instance.use-case';
import { ViewTask } from '../../src/modules/process/application/use-cases/view-task.use-case';
import { ViewWorkingCalendar } from '../../src/modules/process/application/use-cases/view-working-calendar.use-case';
import {
  PROCESS_PERMISSIONS,
  PROCESS_TASKS_ASSIGN,
  PROCESS_TASKS_WORK,
} from '../../src/modules/process/contracts/permissions';
import { NodeBridgeHashing } from '../../src/modules/process/infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from '../../src/modules/process/infrastructure/prisma-process.repository';
import { CallLostError, FakeProcessEngine } from '../support/fake-process-engine';
import {
  ANY_FORMS,
  RecordingAuditWriter,
  testTenantRegistry,
} from '../support/process-test-support';
import { TEST_TENANTS } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { testDatabaseUrl } from './test-database';

// Phase 2 slice 2.3: the task inbox end to end against PostgreSQL (real repository, UnitOfWork,
// tenant guard and row-level security) and the in-memory engine, for both tenant fixtures with
// their own time zones. Identity and the site tree are stand-ins of their ports: the holdings
// below and a site tree Fars -> Shiraz, with Tehran beside Fars. The gate admits every staff
// actor; which tasks each may act on is the inbox's own decision, which these scenarios check.

const WORK = PROCESS_TASKS_WORK.key as string;
const ASSIGN = PROCESS_TASKS_ASSIGN.key as string;

export function taskInboxScenarios(): void {
  describe.each(TEST_TENANTS)('the task inbox in tenant %s (database integration)', (code) => {
    const tenant: TenantContext = tenantOf(code);
    const other: TenantContext = tenantOf(otherTenantOf(code));
    const index = TEST_TENANTS.indexOf(code);
    // A Wednesday in both zones (Asia/Tehran 15:30, America/Toronto 07:00), after the bridge
    // scenarios' clocks so the shared sync watermarks never hide this run's history.
    const clock = new FixedClock(
      Temporal.Instant.from('2026-11-04T12:00:00Z').add({ minutes: index }),
    );
    const ids = new SequenceIdGenerator(clock);
    const audit = new RecordingAuditWriter();
    const engine = new FakeProcessEngine(clock);
    const tenants = testTenantRegistry();
    const zone = tenants.get(tenant.tenantId).timeZone;
    const system = testCallContext(tenant, 'system');

    const site = {
      fars: ids.next<'Site'>(),
      shiraz: ids.next<'Site'>(),
      tehran: ids.next<'Site'>(),
    };
    const parentOf = new Map<string, string>([[site.shiraz, site.fars]]);
    const sites: SiteAncestryReader = {
      siteExists: (_context, siteId) => Promise.resolve(Object.values(site).includes(siteId)),
      isWithinSubtree: (_context, siteId, rootId) => {
        for (let at = parentOf.get(siteId); at !== undefined; at = parentOf.get(at)) {
          if (at === rootId) return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
      sitesWithin: (_context, rootId) =>
        Promise.resolve(
          Object.values(site).filter(
            (siteId) => siteId === rootId || parentOf.get(siteId) === rootId,
          ),
        ),
    };
    // A different weekend per tenant, so a calendar read across tenants would show.
    const weekendDays = index === 0 ? [5] : [6];
    const role = { reviewer: ids.next<'Role'>(), manager: ids.next<'Role'>() };
    const holdings = new Map<string, RoleHolding[]>();
    const reader: RoleHoldingReader = {
      holdingsOf: (_context, accountId) => Promise.resolve(holdings.get(accountId) ?? []),
    };

    /** A staff member of `of` holding `roleId` with `keys` at `scope`. */
    function staffMember(
      of: TenantContext,
      grants: { roleId: Id<'Role'>; keys: string[]; at: Id<'Site'> | 'tenant'; below?: boolean }[],
    ): CallContext {
      const accountId = ids.next<'Account'>();
      holdings.set(
        accountId,
        grants.map((grant) => ({
          roleId: grant.roleId,
          keys: new Set(grant.keys),
          scope:
            grant.at === 'tenant'
              ? { level: 'tenant' }
              : { level: 'site', siteId: grant.at, includeDescendants: grant.below ?? false },
        })),
      );
      const context = testCallContext(
        of,
        testAuthenticatedActor(of, {
          population: 'tenant-staff',
          accountId,
          sessionId: ids.next<'Session'>(),
        }),
      );
      return context;
    }
    const accountOf = (who: CallContext): Id<'Account'> => {
      if (who.actor.kind !== 'authenticated') throw new Error('not staff');
      return who.actor.accountId;
    };

    const publisher = staffMember(tenant, []);
    const farsReviewer = staffMember(tenant, [
      { roleId: role.reviewer, keys: [WORK], at: site.fars },
    ]);
    const secondFarsReviewer = staffMember(tenant, [
      { roleId: role.reviewer, keys: [WORK], at: site.fars },
    ]);
    const tehranReviewer = staffMember(tenant, [
      { roleId: role.reviewer, keys: [WORK], at: site.tehran },
    ]);
    const provinceReviewer = staffMember(tenant, [
      { roleId: role.reviewer, keys: [WORK], at: site.fars, below: true },
    ]);
    const manager = staffMember(tenant, [{ roleId: role.manager, keys: [WORK], at: 'tenant' }]);
    const farsSupervisor = staffMember(tenant, [
      { roleId: ids.next<'Role'>(), keys: [ASSIGN], at: site.fars },
    ]);
    const tehranSupervisor = staffMember(tenant, [
      { roleId: ids.next<'Role'>(), keys: [ASSIGN], at: site.tehran },
    ]);
    const clerk = staffMember(tenant, [{ roleId: ids.next<'Role'>(), keys: [WORK], at: 'tenant' }]);
    const stranger = staffMember(other, [{ roleId: role.reviewer, keys: [WORK], at: 'tenant' }]);

    const model = (key: string) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:phoenix="https://phoenix.example/bpmn" targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" isExecutable="true">
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
    <userTask id="approve" name="بررسی درخواست" phoenix:phoenixRole="${role.reviewer}" phoenix:phoenixDue="P2D" phoenix:phoenixDueDays="working" phoenix:phoenixEscalationRole="${role.manager}" phoenix:phoenixOutcomes="approve,reject"/>
    <sequenceFlow id="f2" sourceRef="approve" targetRef="schedule"/>
    <userTask id="schedule" name="Schedule" phoenix:phoenixAssignee="${accountOf(clerk)}" phoenix:phoenixDue="PT4H"/>
    <sequenceFlow id="f3" sourceRef="schedule" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;

    let persistence: Persistence;
    let rows: Client;
    let flow: ReturnType<typeof build>;
    let revisionId: Id<'ProcessRevision'>;

    function build(p: Persistence) {
      const declared = new Map<string, PermissionDeclaration>(
        PROCESS_PERMISSIONS.declarations.map((d) => [d.key, d]),
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
      const inbox = new TaskInbox(uow, repository, reader, sites, clock);
      return {
        uow,
        repository,
        relay: new CommandRelay(uow, repository, commands, engine, ids, clock, audit),
        sync: new EngineSync(uow, repository, commands, engine, hashing, ids, clock, tenants),
        publish: new PublishProcessRevision(
          gate,
          uow,
          repository,
          commands,
          hashing,
          audit,
          ANY_FORMS,
          clock,
          ids,
        ),
        start: new StartProcessInstance(gate, uow, repository, commands, clock, ids),
        mine: new ListMyTasks(gate, inbox, repository),
        supervised: new ListSiteTasks(gate, inbox, repository),
        view: new ViewTask(gate, inbox),
        claim: new ClaimTask(gate, inbox, uow, repository, audit),
        release: new ReleaseTask(gate, inbox, uow, repository, audit),
        assign: new AssignTask(gate, inbox, uow, repository, audit),
        complete: new CompleteTask(gate, inbox, uow, commands, audit),
        escalate: new EscalateOverdueTasks(gate, uow, repository, audit, clock),
        calendar: new ViewWorkingCalendar(gate, uow, repository),
        replaceCalendar: new ReplaceWorkingCalendar(gate, uow, repository, audit, clock),
      };
    }

    beforeAll(async () => {
      persistence = createPersistence();
      rows = new Client({ connectionString: testDatabaseUrl() });
      await rows.connect();
      flow = build(persistence);
      // The calendar of this run: Fridays (or Saturdays) off, and Thursday 2026-11-05 a holiday.
      const current = await flow.calendar.execute(publisher, undefined);
      if (!current.ok) throw new Error('setup: calendar');
      const replaced = await flow.replaceCalendar.execute(publisher, {
        weekendDays,
        holidays: ['2026-11-05'],
        version: current.value.version,
      });
      if (!replaced.ok) throw new Error(`setup: ${replaced.error.code}`);
      const key = `inbox_${code.replace('-', '_')}_${ids.next<'Probe'>().slice(-8)}`;
      const published = await flow.publish.execute(publisher, {
        processKey: key,
        bpmnXml: model(key),
      });
      if (!published.ok) throw new Error(`setup: ${published.error.code}`);
      revisionId = published.value.id;
    });

    afterAll(async () => {
      await rows.end();
      await persistence.close();
    });

    async function rowsOf<R extends object>(of: TenantContext, sql: string, params: unknown[]) {
      await rows.query('BEGIN');
      try {
        await rows.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [of.tenantId]);
        return (await rows.query<R>(sql, params)).rows;
      } finally {
        await rows.query('ROLLBACK');
      }
    }

    /** Starts a run at `siteId` and syncs until its first task is in the core. */
    async function taskAt(siteId: Id<'Site'> | null): Promise<Id<'ProcessTask'>> {
      const started = await flow.start.execute(system, { revisionId, siteId, variables: {} });
      if (!started.ok) throw new Error(`setup: ${started.error.code}`);
      await flow.relay.runOnce(system);
      await flow.sync.runOnce(system);
      const found = await rowsOf<{ id: Id<'ProcessTask'> }>(
        tenant,
        'SELECT id FROM process.process_task WHERE instance_id = $1',
        [started.value.id],
      );
      expect(found).toHaveLength(1);
      return found[0]!.id;
    }

    const inboxOf = async (who: CallContext) => {
      const listed = await flow.mine.execute(who, { limit: 100 });
      if (!listed.ok) throw new Error('list refused');
      return listed.value.map((task) => task.id);
    };
    const taskRow = async (id: string) =>
      (
        await rowsOf<{
          status: string;
          candidate_role_id: string | null;
          assignee_account_id: string | null;
          escalated_at: Date | null;
          outcome: string | null;
          due_at: Date | null;
          engine_task_id: string;
        }>(
          tenant,
          'SELECT status, candidate_role_id, assignee_account_id, escalated_at, outcome, due_at, engine_task_id FROM process.process_task WHERE id = $1',
          [id],
        )
      )[0]!;

    it('stores the modeller settings with the revision and refuses invalid ones (422)', async () => {
      const key = `bad_${code.replace('-', '_')}`;
      const refused = await flow.publish.execute(publisher, {
        processKey: key,
        bpmnXml: model(key).replace('phoenix:phoenixDue="P2D"', 'phoenix:phoenixDue="P2W"'),
      });
      expect(refused).toEqual({
        ok: false,
        error: { code: 'process.bpmn.task-setting-invalid', field: 'phoenixDue' },
      });
      const stored = await rowsOf<{ task_settings: Record<string, Record<string, string>> }>(
        tenant,
        'SELECT task_settings FROM process.process_revision WHERE id = $1',
        [revisionId],
      );
      expect(stored[0]!.task_settings.approve).toMatchObject({
        phoenixRole: role.reviewer,
        phoenixDue: 'P2D',
        phoenixDueDays: 'working',
        phoenixEscalationRole: role.manager,
        phoenixOutcomes: 'approve,reject',
      });
    });

    it('puts a task in its role queue at the run site, due on the working calendar', async () => {
      const opened = clock.now();
      const id = await taskAt(site.fars);
      const row = await taskRow(id);
      expect(row.candidate_role_id).toBe(role.reviewer);
      expect(row.assignee_account_id).toBeNull();
      // Wednesday + 2 working days: Thursday is a holiday and Friday (or Saturday) the weekend,
      // so Sunday either way, at the same time of day in the tenant's zone.
      const expected = opened.toZonedDateTimeISO(zone).add({ days: 4 });
      expect(expected.dayOfWeek).toBe(7);
      expect(row.due_at?.toISOString()).toBe(new Date(expected.epochMilliseconds).toISOString());

      expect(await inboxOf(farsReviewer)).toContain(id);
      expect(await inboxOf(provinceReviewer)).toContain(id);
      // Another site's reviewer, a person without the role and another tenant see nothing.
      expect(await inboxOf(tehranReviewer)).not.toContain(id);
      expect(await inboxOf(clerk)).not.toContain(id);
      expect(await inboxOf(stranger)).not.toContain(id);
      expect(await flow.view.execute(tehranReviewer, { taskId: id })).toEqual({
        ok: false,
        error: { code: 'process.task.not-found' },
      });
      expect(await flow.view.execute(stranger, { taskId: id })).toEqual({
        ok: false,
        error: { code: 'process.task.not-found' },
      });
      const seen = await flow.view.execute(farsReviewer, { taskId: id });
      expect(seen.ok && seen.value).toMatchObject({
        name: 'بررسی درخواست',
        siteId: site.fars,
        queueRoleId: role.reviewer,
        outcomes: ['approve', 'reject'],
        overdue: false,
      });
    });

    it('lets one holder claim from the queue, and gives it back on release', async () => {
      const id = await taskAt(site.shiraz);
      // Shiraz is below Fars: only the reviewer whose grant includes descendants reaches it.
      expect(await inboxOf(farsReviewer)).not.toContain(id);
      expect(await flow.claim.execute(provinceReviewer, { taskId: id })).toMatchObject({
        ok: true,
      });
      expect((await taskRow(id)).assignee_account_id).toBe(accountOf(provinceReviewer));
      expect(await flow.claim.execute(provinceReviewer, { taskId: id })).toEqual({
        ok: false,
        error: { code: 'process.task.unavailable' },
      });
      expect(await flow.release.execute(provinceReviewer, { taskId: id })).toMatchObject({
        ok: true,
      });
      expect((await taskRow(id)).assignee_account_id).toBeNull();
      expect(audit.entries.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['process.task.claimed', 'process.task.released']),
      );
    });

    it('keeps a claimed task from the rest of the queue', async () => {
      const id = await taskAt(site.fars);
      expect(await flow.claim.execute(farsReviewer, { taskId: id })).toMatchObject({ ok: true });
      expect(await inboxOf(secondFarsReviewer)).not.toContain(id);
      expect(await flow.claim.execute(secondFarsReviewer, { taskId: id })).toEqual({
        ok: false,
        error: { code: 'process.task.unavailable' },
      });
      expect(
        await flow.complete.execute(secondFarsReviewer, { taskId: id, outcome: 'approve' }),
      ).toEqual({
        ok: false,
        error: { code: 'process.task.unavailable' },
      });
    });

    it('completes through the relay with the outcome, then the direct assignee gets the next task', async () => {
      const id = await taskAt(site.fars);
      expect(await flow.complete.execute(farsReviewer, { taskId: id, outcome: 'maybe' })).toEqual({
        ok: false,
        error: { code: 'process.task.outcome-invalid', field: 'outcome' },
      });
      expect(await flow.complete.execute(farsReviewer, { taskId: id, outcome: 'approve' })).toEqual(
        {
          ok: true,
          value: { status: 'completing' },
        },
      );
      const completing = await taskRow(id);
      expect(completing).toMatchObject({
        status: 'completing',
        outcome: 'approve',
        assignee_account_id: accountOf(farsReviewer),
      });
      await flow.relay.runOnce(system);
      const engineTask = engine.tasks.find((task) => task.id === completing.engine_task_id)!;
      expect(engineTask.completedWith).toEqual({ phoenixOutcome: 'approve' });
      expect((await taskRow(id)).status).toBe('completed');

      // The model's next step goes straight to one person, due four calendar hours later.
      engine.openTask(engineTask.instanceId, 'schedule');
      const opened = clock.now();
      await flow.sync.runOnce(system);
      const next = await rowsOf<{ id: Id<'ProcessTask'>; due_at: Date }>(
        tenant,
        "SELECT id, due_at FROM process.process_task WHERE task_key = 'schedule' AND instance_id = (SELECT instance_id FROM process.process_task WHERE id = $1)",
        [id],
      );
      expect(next).toHaveLength(1);
      expect(next[0]!.due_at.toISOString()).toBe(
        new Date(opened.add({ hours: 4 }).epochMilliseconds).toISOString(),
      );
      expect(await inboxOf(clerk)).toContain(next[0]!.id);
      expect(await inboxOf(farsReviewer)).not.toContain(next[0]!.id);
      // A task sent to one person does not go back to a queue.
      expect(await flow.release.execute(clerk, { taskId: next[0]!.id })).toEqual({
        ok: false,
        error: { code: 'process.task.unavailable' },
      });
    });

    it('lets exactly one of two queue members claim the same task at once', async () => {
      const id = await taskAt(site.fars);
      const settled = await Promise.allSettled([
        flow.claim.execute(farsReviewer, { taskId: id }),
        flow.claim.execute(secondFarsReviewer, { taskId: id }),
      ]);
      const won = settled.filter(
        (result) => result.status === 'fulfilled' && result.value.ok,
      ).length;
      // The loser reads the task taken (409 unavailable) or loses the version race (409 stale).
      const lost = settled.filter(
        (result) =>
          (result.status === 'fulfilled' &&
            !result.value.ok &&
            result.value.error.code === 'process.task.unavailable') ||
          (result.status === 'rejected' && result.reason instanceof StaleAggregateError),
      ).length;
      expect([won, lost]).toEqual([1, 1]);
      expect(
        audit.entries.filter(
          (entry) => entry.action === 'process.task.claimed' && entry.targetId === id,
        ),
      ).toHaveLength(1);
    });

    it('lets a supervisor of the site give a task to an eligible person only', async () => {
      const id = await taskAt(site.fars);
      expect(
        await flow.assign.execute(tehranSupervisor, {
          taskId: id,
          accountId: accountOf(farsReviewer),
        }),
      ).toEqual({ ok: false, error: { code: 'process.task.not-found' } });
      expect(
        await flow.assign.execute(farsSupervisor, {
          taskId: id,
          accountId: accountOf(tehranReviewer),
        }),
      ).toEqual({
        ok: false,
        error: { code: 'process.task.assignee-ineligible', field: 'accountId' },
      });
      expect(
        await flow.assign.execute(farsSupervisor, {
          taskId: id,
          accountId: accountOf(secondFarsReviewer),
        }),
      ).toMatchObject({ ok: true });
      expect(await inboxOf(secondFarsReviewer)).toContain(id);
      const supervised = await flow.supervised.execute(farsSupervisor, { limit: 100 });
      expect(supervised.ok && supervised.value.map((task) => task.id)).toContain(id);
      const elsewhere = await flow.supervised.execute(tehranSupervisor, { limit: 100 });
      expect(elsewhere.ok && elsewhere.value.map((task) => task.id)).not.toContain(id);
    });

    it('escalates an overdue task to the manager queue; the first queue may no longer decide it', async () => {
      const id = await taskAt(site.fars);
      expect(await flow.claim.execute(farsReviewer, { taskId: id })).toMatchObject({ ok: true });
      clock.advance(Temporal.Duration.from({ hours: 5 * 24 }));
      // Due, not yet escalated: the deadline already won.
      expect(await flow.complete.execute(farsReviewer, { taskId: id, outcome: 'approve' })).toEqual(
        {
          ok: false,
          error: { code: 'process.task.unavailable' },
        },
      );
      // Nor may a supervisor hand it to someone of the first queue.
      expect(
        await flow.assign.execute(farsSupervisor, {
          taskId: id,
          accountId: accountOf(secondFarsReviewer),
        }),
      ).toEqual({ ok: false, error: { code: 'process.task.unavailable' } });
      const pass = await flow.escalate.execute(system, undefined);
      // Earlier scenarios' tasks are overdue too: this one is among them.
      expect(pass.ok && pass.value.escalated).toBeGreaterThanOrEqual(1);
      // The job is safe to run twice: a second pass finds nothing left to escalate.
      expect(await flow.escalate.execute(system, undefined)).toEqual({
        ok: true,
        value: { escalated: 0 },
      });
      expect(
        audit.entries.filter(
          (entry) => entry.action === 'process.task.escalated' && entry.targetId === id,
        ),
      ).toHaveLength(1);
      const row = await taskRow(id);
      expect(row).toMatchObject({
        status: 'open',
        candidate_role_id: role.manager,
        assignee_account_id: null,
      });
      expect(row.escalated_at).not.toBeNull();
      expect(await inboxOf(farsReviewer)).not.toContain(id);
      expect(await inboxOf(manager)).toContain(id);
      expect(await flow.complete.execute(manager, { taskId: id, outcome: 'reject' })).toMatchObject(
        {
          ok: true,
        },
      );
      expect(audit.entries.map((entry) => entry.action)).toContain('process.task.escalated');
    });

    it('lets the deadline win over a decision that never reached the engine (R7)', async () => {
      const id = await taskAt(site.fars);
      expect(
        await flow.complete.execute(farsReviewer, { taskId: id, outcome: 'approve' }),
      ).toMatchObject({
        ok: true,
      });
      engine.down = true;
      await flow.relay.runOnce(system);
      engine.down = false;
      clock.advance(Temporal.Duration.from({ hours: 5 * 24 }));
      // Nothing escalates a task whose decision is on its way; the relay decides.
      await flow.escalate.execute(system, undefined);
      expect((await taskRow(id)).status).toBe('completing');
      await flow.relay.runOnce(system);
      const row = await taskRow(id);
      expect(row).toMatchObject({
        status: 'open',
        candidate_role_id: role.manager,
        assignee_account_id: null,
        outcome: 'approve',
      });
      const engineTask = engine.tasks.find((task) => task.id === row.engine_task_id)!;
      expect(engineTask.endedAt).toBeNull();
      const commands = await rowsOf<{ dead_at: Date | null; last_error: string | null }>(
        tenant,
        "SELECT dead_at, last_error FROM process.engine_command WHERE subject_id = $1 AND kind = 'complete-task'",
        [id],
      );
      expect(commands).toEqual([
        { dead_at: expect.any(Date) as Date, last_error: 'task.superseded' },
      ]);
      const incidents = await rowsOf<{ kind: string }>(
        tenant,
        'SELECT kind FROM process.process_incident WHERE engine_ref = $1',
        [row.engine_task_id],
      );
      expect(incidents.map((incident) => incident.kind)).toEqual(['completion-superseded']);
      expect(audit.entries.map((entry) => entry.action)).toContain(
        'process.task.completion-superseded',
      );
      expect(await inboxOf(manager)).toContain(id);
    });

    it('closes a decision the engine applied although its answer was lost, never supersedes it', async () => {
      const id = await taskAt(site.fars);
      expect(
        await flow.complete.execute(farsReviewer, { taskId: id, outcome: 'reject' }),
      ).toMatchObject({ ok: true });
      // The engine applies the completion and the worker dies before it hears so.
      engine.loseAnswerOf = 'completeTask';
      await expect(flow.relay.runOnce(system)).rejects.toBeInstanceOf(CallLostError);
      // The deadline passes before the command's lease does.
      clock.advance(Temporal.Duration.from({ hours: 5 * 24 }));
      await flow.relay.runOnce(system);
      const row = await taskRow(id);
      expect(row.status).toBe('completed');
      expect(
        audit.entries.filter(
          (entry) => entry.action === 'process.task.completion-superseded' && entry.targetId === id,
        ),
      ).toEqual([]);
      const incidents = await rowsOf<{ kind: string }>(
        tenant,
        'SELECT kind FROM process.process_incident WHERE engine_ref = $1',
        [row.engine_task_id],
      );
      expect(incidents).toEqual([]);
    });

    it('keeps the working calendar per tenant, versioned and checked', async () => {
      const current = await flow.calendar.execute(publisher, undefined);
      expect(current).toMatchObject({
        ok: true,
        value: { weekendDays, holidays: ['2026-11-05'] },
      });
      if (!current.ok) return;
      expect(
        await flow.replaceCalendar.execute(publisher, {
          weekendDays: [1, 2, 3, 4, 5, 6, 7],
          holidays: [],
          version: current.value.version,
        }),
      ).toEqual({ ok: false, error: { code: 'process.calendar.invalid', field: 'weekendDays' } });
      expect(
        await flow.replaceCalendar.execute(publisher, {
          weekendDays: [5],
          holidays: ['2026-02-30'],
          version: current.value.version,
        }),
      ).toEqual({ ok: false, error: { code: 'process.calendar.invalid', field: 'holidays' } });
      await expect(
        flow.replaceCalendar.execute(publisher, {
          weekendDays: [5, 6],
          holidays: [],
          version: current.value.version + 7,
        }),
      ).rejects.toBeInstanceOf(StaleAggregateError);
      // Row-level security: the tenant sees its own calendar row only.
      expect(
        await rowsOf<{ tenant_id: string }>(
          tenant,
          'SELECT tenant_id FROM process.working_calendar',
          [],
        ),
      ).toEqual([{ tenant_id: code }]);
    });
  });
}
