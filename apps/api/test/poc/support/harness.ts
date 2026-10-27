import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import {
  testAuthenticatedActor,
  testCallContext,
  testTenantContext,
} from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import {
  CommandRelay,
  type RelayOptions,
} from '../../../src/modules/process/application/bridge/command-relay';
import { EngineSync } from '../../../src/modules/process/application/bridge/engine-sync';
import type { ApproverDirectory } from '../../../src/modules/process/application/ports/collaborators';
import { CompleteTask } from '../../../src/modules/process/application/use-cases/complete-task.use-case';
import { ListMyTasks } from '../../../src/modules/process/application/use-cases/list-my-tasks.use-case';
import { SubmitRequest } from '../../../src/modules/process/application/use-cases/submit-request.use-case';
import { AjvFormValidator } from '../../../src/modules/process/infrastructure/ajv-form-validator';
import { FlowableRestEngine } from '../../../src/modules/process/infrastructure/flowable/flowable-rest-engine';
import { NodeContentHasher } from '../../../src/modules/process/infrastructure/node-content-hasher';
import { PrismaProcessStore } from '../../../src/modules/process/infrastructure/prisma-process-store';
import { SystemClock } from '../../../src/platform/clock/system-clock';
import { UuidV7IdGenerator } from '../../../src/platform/ids/uuid-v7-id-generator';
import { createPersistence, type Persistence } from '../../db/persistence-support';
import { ownerTestDatabaseUrl } from '../../db/test-database';
import { FaultyEngine } from './faulty-engine';
import {
  clearTenant,
  FLOWABLE_REST_URL,
  historicTasksOf,
  instancesOf,
  openTasksOf,
} from './flowable';

export const TENANTS = ['demo-fa', 'demo-en'] as const;
export const FORM_KEY = 'leave-request';
export const PROCESS_KEY = 'leave-approval';
// A process definition is content: published as a core revision (V1) and deployed per tenant.
// Phase 2 brings it from the modeller (bpmn-js); the PoC reads a fixture.
const BPMN = readFileSync(path.resolve(__dirname, '../fixtures/leave-approval.bpmn20.xml'), 'utf8');

/** The leave request form: JSON Schema (validated) and UI Schema (stored, rendered later). */
export const LEAVE_FORM = {
  jsonSchema: {
    type: 'object',
    required: ['leaveType', 'startDate', 'days'],
    additionalProperties: false,
    properties: {
      leaveType: { type: 'string', enum: ['annual', 'sick', 'unpaid'] },
      startDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      days: { type: 'integer', minimum: 1, maximum: 30 },
    },
  },
  uiSchema: { type: 'VerticalLayout', elements: [] },
};
export const VALID_ANSWERS = { leaveType: 'annual', startDate: '2026-11-10', days: 3 };

/** The people of one tenant: account ids only. */
export interface People {
  readonly requester: string;
  readonly approver: string;
  readonly manager: string;
  readonly outsider: string;
}

export interface BridgeOptions {
  readonly relay?: Partial<RelayOptions>;
}

/**
 * Everything the bridge needs, built as the worker and the API would build it (without Nest):
 * the real Prisma persistence on the run's throwaway database, the real Flowable adapter behind
 * the fault-injecting decorator, the system clock (the engine's timers run on real time).
 */
export class Harness {
  readonly clock = new SystemClock();
  readonly ids = new UuidV7IdGenerator(this.clock);
  readonly persistence: Persistence = createPersistence();
  readonly store = new PrismaProcessStore(this.persistence.service);
  readonly flowable = new FlowableRestEngine({
    baseUrl: FLOWABLE_REST_URL,
    user: 'rest-admin',
    password: 'test',
    timeoutMs: 5_000,
  });
  readonly engine = new FaultyEngine(this.flowable);
  readonly hasher = new NodeContentHasher();
  readonly people = new Map<string, People>();
  /** Seconds before the approver's task escalates; long unless a test shortens it. */
  escalateAfterSeconds = 3600;

  private readonly directory: ApproverDirectory = {
    approversOf: (context, requesterId) => {
      const people = this.people.get(context.tenant.tenantId);
      return Promise.resolve(
        people?.requester === requesterId
          ? { approverId: people.approver, managerId: people.manager }
          : null,
      );
    },
  };

  readonly submit = new SubmitRequest(
    this.persistence.unitOfWork,
    this.store,
    new AjvFormValidator(),
    this.hasher,
    this.directory,
    { escalateAfterSeconds: () => this.escalateAfterSeconds },
    this.ids,
    this.clock,
  );
  readonly completeTask = new CompleteTask(
    this.persistence.unitOfWork,
    this.store,
    this.ids,
    this.clock,
  );
  readonly listMyTasks = new ListMyTasks(this.persistence.unitOfWork, this.store);
  readonly sync = this.newSync();
  relay = this.newRelay();

  newRelay(options: Partial<RelayOptions> = {}): CommandRelay {
    return new CommandRelay(
      this.persistence.unitOfWork,
      this.store,
      this.engine,
      this.ids,
      this.clock,
      { leaseMs: 60_000, batchSize: 20, retryAfterMs: 0, ...options },
    );
  }

  newSync(engine = this.engine): EngineSync {
    return new EngineSync(
      this.persistence.unitOfWork,
      this.store,
      engine,
      this.hasher,
      this.ids,
      this.clock,
    );
  }

  tenant(code: string): TenantContext {
    return testTenantContext(code);
  }

  /** Publishes the form and process revisions for each tenant and deploys the process. */
  async seed(): Promise<void> {
    for (const code of TENANTS) {
      const tenant = this.tenant(code);
      await clearTenant(code);
      const now = this.clock.now();
      const processRevisionId = this.ids.next<'ProcessRevision'>();
      // Spec files share the run database: each one publishes the next revision (V1).
      await this.persistence.unitOfWork.run(tenant, async () => {
        const form = await this.store.latestFormRevision(tenant, FORM_KEY);
        const process = await this.store.latestProcessRevision(tenant, PROCESS_KEY);
        await this.store.insertFormRevision(tenant, {
          id: this.ids.next<'FormRevision'>(),
          formKey: FORM_KEY,
          revision: (form?.revision ?? 0) + 1,
          ...LEAVE_FORM,
          contentHash: this.hasher.hashOf(LEAVE_FORM),
          publishedAt: now,
        });
        await this.store.insertProcessRevision(tenant, {
          id: processRevisionId,
          processKey: PROCESS_KEY,
          revision: (process?.revision ?? 0) + 1,
          bpmnXml: BPMN,
          contentHash: this.hasher.hashOf(BPMN),
          publishedAt: now,
        });
        return ok(undefined);
      });
      await this.flowable.deployRevision(tenant, {
        processKey: PROCESS_KEY,
        revisionId: processRevisionId,
        bpmnXml: BPMN,
      });
      this.people.set(code, {
        requester: this.ids.next(),
        approver: this.ids.next(),
        manager: this.ids.next(),
        outsider: this.ids.next(),
      });
    }
  }

  /** The CallContext of one person of a tenant, as the identity module will mint it. */
  as(code: string, who: keyof People): CallContext {
    const tenant = this.tenant(code);
    const accountId = this.people.get(code)![who] as Id<'Account'>;
    return testCallContext(
      tenant,
      testAuthenticatedActor(tenant, {
        population: 'tenant-staff',
        accountId,
        sessionId: this.ids.next<'Session'>(),
      }),
    );
  }

  async submitLeave(code: string): Promise<string> {
    const result = await this.submit.execute(this.as(code, 'requester'), {
      formKey: FORM_KEY,
      processKey: PROCESS_KEY,
      answers: VALID_ANSWERS,
    });
    if (!result.ok) throw new Error(`submit failed: ${JSON.stringify(result.error)}`);
    return result.value.requestId;
  }

  async inboxOf(code: string, who: keyof People) {
    const result = await this.listMyTasks.execute(this.as(code, who));
    if (!result.ok) throw new Error('list failed');
    return result.value;
  }

  async decide(code: string, who: keyof People, taskId: string, decision: 'approve' | 'reject') {
    return this.completeTask.execute(this.as(code, who), { taskId, decision });
  }

  /** Relay and sync passes until a pass changes nothing (or `passes` run out). */
  async converge(code: string, passes = 6): Promise<void> {
    const tenant = this.tenant(code);
    for (let pass = 0; pass < passes; pass += 1) {
      const relayed = await this.relay.runOnce(tenant);
      const synced = await this.sync.runOnce(tenant);
      if (relayed.claimed === 0 && synced.applied === 0) return;
    }
  }

  /** Rows of the run database as the owner (bypasses RLS): what the test inspects. */
  async sql<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
    const client = new Client({ connectionString: ownerTestDatabaseUrl() });
    await client.connect();
    try {
      return (await client.query<T>(text, values)).rows;
    } finally {
      await client.end();
    }
  }

  /**
   * The PoC criterion for one request, after convergence: no task lost, none duplicated.
   * - exactly one live engine instance with the request id as business key (deleted orphans
   *   aside), and it is the one the core adopted;
   * - every task that instance ever had is in the core exactly once;
   * - the core's open tasks of the request are exactly the engine's open tasks.
   */
  async criterion(code: string, requestId: string): Promise<CriterionReport> {
    const [request] = await this.sql<{ process_instance_id: string | null; status: string }>(
      'SELECT process_instance_id, status FROM process.request WHERE tenant_id = $1 AND id = $2',
      [code, requestId],
    );
    const instances = await instancesOf(code, requestId);
    const live = instances.filter(
      (row) => row.deleteReason === null || row.deleteReason === undefined,
    );
    const instanceId = request?.process_instance_id ?? null;
    const engineTasks = instanceId === null ? [] : await historicTasksOf(code, instanceId);
    const engineOpen = instanceId === null ? [] : await openTasksOf(code, instanceId);
    const coreTasks = await this.sql<{ engine_task_id: string; status: string }>(
      'SELECT engine_task_id, status FROM process.task WHERE tenant_id = $1 AND request_id = $2',
      [code, requestId],
    );
    const coreIds = coreTasks.map((row) => row.engine_task_id);
    const coreOpen = coreTasks
      .filter((row) => row.status === 'open' || row.status === 'completing')
      .map((row) => row.engine_task_id)
      .sort();
    const lost = engineTasks.map((row) => row.id).filter((id) => !coreIds.includes(id));
    const duplicated = coreIds.filter((id, index) => coreIds.indexOf(id) !== index);
    return {
      requestStatus: request?.status ?? 'missing',
      liveInstances: live.length,
      adoptedIsLive: live.length === 1 && live[0]!.id === instanceId,
      deletedOrphans: instances.length - live.length,
      engineTasks: engineTasks.length,
      coreTasks: coreTasks.length,
      lost,
      duplicated,
      openMatches:
        JSON.stringify(coreOpen) === JSON.stringify(engineOpen.map((row) => row.id).sort()),
    };
  }

  async incidents(code: string): Promise<{ kind: string; engine_ref: string }[]> {
    return this.sql('SELECT kind, engine_ref FROM process.incident WHERE tenant_id = $1', [code]);
  }

  async close(): Promise<void> {
    await this.persistence.close();
  }
}

export interface CriterionReport {
  readonly requestStatus: string;
  readonly liveInstances: number;
  readonly adoptedIsLive: boolean;
  readonly deletedOrphans: number;
  readonly engineTasks: number;
  readonly coreTasks: number;
  readonly lost: readonly string[];
  readonly duplicated: readonly string[];
  readonly openMatches: boolean;
}

/** The criterion holds: one live instance, nothing lost, nothing duplicated, open sets equal. */
export function expectCriterion(report: CriterionReport): void {
  expect(report).toMatchObject({
    liveInstances: 1,
    adoptedIsLive: true,
    lost: [],
    duplicated: [],
    openMatches: true,
  });
  expect(report.coreTasks).toBe(report.engineTasks);
}

/** Polls `probe` until it returns true or `timeoutMs` passes. */
export async function eventually(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error('eventually: timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
