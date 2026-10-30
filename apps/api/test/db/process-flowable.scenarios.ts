import { randomUUID } from 'node:crypto';
import type { CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import { SequenceIdGenerator, testCallContext } from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import { SystemClock } from '../../src/platform/clock/system-clock';
import { CommandRelay } from '../../src/modules/process/application/bridge/command-relay';
import { EngineSync } from '../../src/modules/process/application/bridge/engine-sync';
import { EngineCommands } from '../../src/modules/process/application/engine-commands';
import { EngineTenantMismatchError } from '../../src/modules/process/application/ports/process-engine';
import { checkBpmn } from '../../src/modules/process/domain/bpmn-guard';
import { FlowableRestEngine } from '../../src/modules/process/infrastructure/flowable/flowable-rest-engine';
import { NodeBridgeHashing } from '../../src/modules/process/infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from '../../src/modules/process/infrastructure/prisma-process.repository';
import {
  decisionProcess,
  decisionTable,
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

// Phase 2 slice 2.2 against the real engine: the Flowable image of slice 2.1 (CI starts it on
// port 8090 before `pnpm verify`). The bridge runs through the REST adapter, the real repository
// and row-level security, for both tenant fixtures, on a model that passed the intake check:
// start, surface, complete with the key, a boundary timer that escalates, an orphan removed, and
// another tenant's task refused by the adapter.
//
// FLOWABLE_TEST_URL and FLOWABLE_TEST_PASSWORD name the engine. CI sets them and the suite fails
// without them there; a developer without a local Flowable runs the rest of test:db.
//
// process.db-spec.ts runs these after its own scenarios, in the same file: both drive the one
// sync state row of each tenant, and two Jest workers on it at once would move each other's
// watermarks (the fake engine's clock runs ahead of the real one).

const URL_VARIABLE = process.env.FLOWABLE_TEST_URL;
const PASSWORD = process.env.FLOWABLE_TEST_PASSWORD;
const configured = URL_VARIABLE !== undefined && PASSWORD !== undefined;
if (!configured && process.env.CI !== undefined) {
  throw new Error('CI must set FLOWABLE_TEST_URL and FLOWABLE_TEST_PASSWORD (slice 2.1 Flowable)');
}

const model = (key: string) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:flowable="http://flowable.org/bpmn"
  xmlns:phoenix="urn:phoenix:bpmn" targetNamespace="http://phoenix.example/bpmn">
  <process id="${key}" name="Leave approval" isExecutable="true">
    <startEvent id="start"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="approve"/>
    <userTask id="approve" name="Approve" flowable:formKey="leave-decision"/>
    <boundaryEvent id="deadline" attachedToRef="approve" cancelActivity="true">
      <timerEventDefinition><timeDate>\${escalateAt}</timeDate></timerEventDefinition>
    </boundaryEvent>
    <sequenceFlow id="f2" sourceRef="deadline" targetRef="escalate"/>
    <userTask id="escalate" name="Escalate" flowable:formKey="leave-decision"
      phoenix:phoenixDue="P2D" phoenix:phoenixDueDays="working" phoenix:phoenixOutcomes="approve,reject"/>
    <sequenceFlow id="f3" sourceRef="escalate" targetRef="end"/>
    <sequenceFlow id="f4" sourceRef="approve" targetRef="decide"/>
    <exclusiveGateway id="decide" default="rejected"/>
    <sequenceFlow id="approved" sourceRef="decide" targetRef="end">
      <conditionExpression xsi:type="tFormalExpression">\${outcome == 'approve'}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="rejected" sourceRef="decide" targetRef="end"/>
    <endEvent id="end"/>
  </process>
</definitions>`;

/** One decision key for both tenant fixtures of a run: each publishes its own table under it. */
const RUN_TABLE_KEY = `routing_${randomUUID().slice(0, 8)}`;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function realFlowableScenarios(): void {
  (configured ? describe.each(TEST_TENANTS) : describe.skip.each(TEST_TENANTS))(
    'the process bridge on the real Flowable in tenant %s',
    (code) => {
      const tenant: TenantContext = tenantOf(code);
      const other: TenantContext = tenantOf(otherTenantOf(code));
      const clock = new SystemClock();
      const ids = new SequenceIdGenerator(clock);
      const system: CallContext = testCallContext(tenant, 'system');
      const audit = new RecordingAuditWriter();
      const tenants = testTenantRegistry();
      const engine = new FlowableRestEngine({
        url: URL_VARIABLE ?? '',
        user: process.env.FLOWABLE_TEST_USER ?? 'rest-admin',
        password: PASSWORD ?? '',
      });
      const key = `leave_${code.replace('-', '_')}_${randomUUID().slice(0, 8)}`;
      let persistence: Persistence;
      let reader: Client;
      let repository: PrismaProcessRepository;
      let commands: EngineCommands;
      let relay: CommandRelay;
      let sync: EngineSync;
      let revisionId: Id<'ProcessRevision'>;

      async function rowsOf<R extends object>(sql: string, params: unknown[] = []): Promise<R[]> {
        await reader.query('BEGIN');
        try {
          await reader.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [code]);
          return (await reader.query<R>(sql, params)).rows;
        } finally {
          await reader.query('ROLLBACK');
        }
      }

      async function unit<T>(work: () => Promise<T>): Promise<T> {
        const result = await persistence.unitOfWork.run(tenant, async () => ({
          ok: true as const,
          value: await work(),
        }));
        if (!result.ok) throw new Error('unit failed');
        return result.value;
      }

      // A deadline in whole seconds: a duration under the guard's minimum (2.6) cannot reach the
      // engine, so the escalation test waits for a date one second away instead.
      const deadlineIn = (seconds: number): string =>
        clock
          .now()
          .add({ seconds })
          .round({ smallestUnit: 'second', roundingMode: 'ceil' })
          .toString();

      async function start(escalateAt: string): Promise<Id<'ProcessInstance'>> {
        const id = ids.next<'ProcessInstance'>();
        await unit(async () => {
          await repository.insertInstance(tenant, { id, revisionId, siteId: null }, clock.now());
          await commands.startInstance(system, id, revisionId, { escalateAt, days: 3 });
        });
        expect(await relay.runOnce(system)).toMatchObject({ delivered: 1 });
        return id;
      }

      const tasksOf = (instanceId: string) =>
        rowsOf<{ id: string; engine_task_id: string; task_key: string; status: string }>(
          'SELECT id, engine_task_id, task_key, status FROM process.process_task WHERE instance_id = $1 ORDER BY task_key',
          [instanceId],
        );
      const instanceOf = async (id: string) =>
        (
          await rowsOf<{ status: string; engine_instance_id: string | null }>(
            'SELECT status, engine_instance_id FROM process.process_instance WHERE id = $1',
            [id],
          )
        )[0]!;

      beforeAll(async () => {
        persistence = createPersistence();
        reader = new Client({ connectionString: testDatabaseUrl() });
        await reader.connect();
        repository = new PrismaProcessRepository(persistence.service);
        commands = new EngineCommands(repository, ids, clock);
        relay = new CommandRelay(
          persistence.unitOfWork,
          repository,
          commands,
          engine,
          ids,
          clock,
          audit,
        );
        sync = new EngineSync(
          persistence.unitOfWork,
          repository,
          commands,
          engine,
          new NodeBridgeHashing(),
          ids,
          clock,
          tenants,
        );
        // History from earlier runs on a long-lived engine is not this run's, and the fake engine's
        // scenarios left their own watermarks: start reading now.
        await unit(async () => {
          const { version } = await repository.readSyncState(tenant);
          const saved = await repository.saveSyncState(
            tenant,
            { tasksEndedAfter: clock.now(), instancesEndedAfter: clock.now() },
            version,
            clock.now(),
          );
          if (!saved) throw new Error('setup: the sync state moved under the test');
        });
        expect(checkBpmn(model(key), key).ok).toBe(true);
        revisionId = ids.next<'ProcessRevision'>();
        await unit(async () => {
          await repository.insertRevision(
            tenant,
            {
              id: revisionId,
              processKey: key,
              revision: 1,
              bpmnXml: model(key),
              contentHash: new NodeBridgeHashing().contentHash(model(key)),
              taskSettings: {},
            },
            clock.now(),
          );
          await commands.deployRevision(system, { id: revisionId });
        });
        expect(await relay.runOnce(system)).toMatchObject({ delivered: 1 });
      });

      afterAll(async () => {
        await reader.end();
        await persistence.close();
      });

      it('deploys once: a repeated deployment is a no-op', async () => {
        await engine.deployRevision(tenant, {
          processKey: key,
          revisionId,
          bpmnXml: model(key),
          decisions: [],
        });
        await unit(() => commands.deployRevision(system, { id: revisionId }));
        expect(await relay.runOnce(system)).toMatchObject({ delivered: 1 });
      });

      it('starts, surfaces, completes with the key and ends the instance', async () => {
        const instanceId = await start(deadlineIn(3600));
        const adopted = await instanceOf(instanceId);
        expect(adopted.status).toBe('running');
        expect(await engine.findInstancesByBusinessKey(tenant, instanceId)).toHaveLength(1);

        await sync.runOnce(system);
        const [task] = await tasksOf(instanceId);
        expect(task).toMatchObject({ task_key: 'approve', status: 'open' });

        const record = await unit(() => repository.findTask(tenant, task!.id));
        expect(
          await unit(() => commands.completeTask(system, record!, { outcome: 'approve' })),
        ).toBe(true);
        expect(await relay.runOnce(system)).toMatchObject({ delivered: 1 });
        expect((await tasksOf(instanceId))[0]!.status).toBe('completed');
        const history = await engine.findTask(tenant, task!.engine_task_id);
        expect(history?.end).toMatchObject({ kind: 'completed' });

        await sync.runOnce(system);
        expect(await instanceOf(instanceId)).toMatchObject({ status: 'completed' });
        expect(
          await rowsOf('SELECT kind FROM process.process_incident WHERE engine_ref = $1', [
            task!.engine_task_id,
          ]),
        ).toEqual([]);
      });

      it('sees a boundary timer escalate the task, as Flowable records it', async () => {
        const instanceId = await start(deadlineIn(1));
        await sync.runOnce(system);
        // Timers are acquired every second in CI and in compose (slice 2.1).
        for (let wait = 0; wait < 20; wait += 1) {
          await pause(1000);
          await sync.runOnce(system);
          const tasks = await tasksOf(instanceId);
          if (tasks.some((t) => t.task_key === 'escalate')) break;
        }
        expect((await tasksOf(instanceId)).map((t) => [t.task_key, t.status])).toEqual([
          ['approve', 'escalated'],
          ['escalate', 'open'],
        ]);
      }, 40_000);

      it('removes a second instance with the business key as an orphan', async () => {
        const instanceId = await start(deadlineIn(3600));
        const orphan = await engine.startInstance(tenant, {
          processKey: key,
          revisionId,
          businessKey: instanceId,
          variables: { escalateAt: deadlineIn(3600) },
        });
        await sync.runOnce(system);
        await relay.runOnce(system);
        expect(
          await rowsOf('SELECT kind FROM process.process_incident WHERE engine_ref = $1', [
            orphan.engineInstanceId,
          ]),
        ).toEqual([{ kind: 'orphan-instance' }]);
        const live = (await engine.findInstancesByBusinessKey(tenant, instanceId)).filter(
          (instance) => instance.endedAt === null,
        );
        expect(live.map((instance) => instance.engineInstanceId)).toEqual([
          (await instanceOf(instanceId)).engine_instance_id,
        ]);
        expect((await tasksOf(instanceId)).map((t) => t.engine_task_id)).not.toContain(
          (await engine.listOpenTasks(tenant)).find(
            (t) => t.engineInstanceId === orphan.engineInstanceId,
          )?.engineTaskId,
        );
      });

      it("runs the tenant's own decision table from a process step (slice 2.7)", async () => {
        // The same key in both tenants, with another fallback lane: the engine must pick this
        // tenant's table.
        const fallback = TEST_TENANTS.indexOf(code) === 0 ? 'clerk' : 'other';
        const decisionId = ids.next<'DecisionRevision'>();
        const dmnXml = decisionTable(RUN_TABLE_KEY, fallback);
        const routedKey = `${key}_routed`;
        const routedRevision = ids.next<'ProcessRevision'>();
        await unit(async () => {
          await repository.insertDecisionRevision(
            tenant,
            {
              id: decisionId,
              decisionKey: RUN_TABLE_KEY,
              revision: 1,
              dmnXml,
              contentHash: new NodeBridgeHashing().contentHash(dmnXml),
            },
            clock.now(),
          );
          await commands.deployDecision(system, { id: decisionId });
          const bpmnXml = decisionProcess(routedKey, RUN_TABLE_KEY);
          await repository.insertRevision(
            tenant,
            {
              id: routedRevision,
              processKey: routedKey,
              revision: 1,
              bpmnXml,
              contentHash: new NodeBridgeHashing().contentHash(bpmnXml),
              taskSettings: {},
            },
            clock.now(),
          );
          await commands.deployRevision(system, { id: routedRevision });
        });
        expect(await relay.runOnce(system)).toMatchObject({ delivered: 2, refused: 0 });

        const routed = async (variables: { days: number; kind: string }) => {
          const id = ids.next<'ProcessInstance'>();
          await unit(async () => {
            await repository.insertInstance(
              tenant,
              { id, revisionId: routedRevision, siteId: null },
              clock.now(),
            );
            await commands.startInstance(system, id, routedRevision, variables);
          });
          expect(await relay.runOnce(system)).toMatchObject({ delivered: 1 });
          await sync.runOnce(system);
          return (await tasksOf(id)).map((task) => task.task_key);
        };
        expect(await routed({ days: 7, kind: 'sick' })).toEqual(['long']);
        expect(await routed({ days: 1, kind: 'annual' })).toEqual([fallback]);
      });

      it("never reads or completes the other tenant's task", async () => {
        const instanceId = await start(deadlineIn(3600));
        await sync.runOnce(system);
        const [task] = await tasksOf(instanceId);
        expect(await engine.findTask(other, task!.engine_task_id)).toBeNull();
        await expect(
          engine.completeTask(other, task!.engine_task_id, {}, randomUUID()),
        ).rejects.toBeInstanceOf(EngineTenantMismatchError);
        expect((await engine.findTask(tenant, task!.engine_task_id))?.end).toBeNull();
      });
    },
  );
}
