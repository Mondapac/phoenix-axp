import { randomUUID } from 'node:crypto';
import type { Clock, Temporal, TenantContext } from '@phoenix/shared-kernel';
import {
  EngineRefusedError,
  EngineUnavailableError,
  type EngineDecision,
  type EngineDeployment,
  type EngineInstance,
  type EngineOpenTask,
  type EngineTaskRecord,
  type ProcessEngine,
  type StartCommand,
} from '../../src/modules/process/application/ports/process-engine';
import type { EngineVariables } from '../../src/modules/process/domain/engine-command';

// An in-memory engine with Flowable's observable behaviour as PoC 3 measured it (section 3):
// tenant-scoped deployments, instances with a business key and no uniqueness on it, user tasks
// with history, task-local variables, delete reasons, and a clock for end times. A test drives
// what the process model would do (open a task, fire a timer, end the instance) and injects
// failures: the engine down, or a call that does its work and never answers (a worker killed
// before its ack).

interface Instance {
  readonly id: string;
  readonly tenantId: string;
  readonly businessKey: string;
  readonly coreInstanceId: string;
  readonly startedAt: Temporal.Instant;
  endedAt: Temporal.Instant | null;
  deleteReason: string | null;
}

interface Task {
  readonly id: string;
  readonly tenantId: string;
  readonly instanceId: string;
  readonly taskKey: string;
  readonly formKey: string | null;
  endedAt: Temporal.Instant | null;
  deleteReason: string | null;
  completionKey: string | null;
  completedWith: EngineVariables | null;
}

/** Thrown by a call that "died" after the engine did its work: the caller never gets the answer. */
export class CallLostError extends Error {
  override readonly name = 'CallLostError';
}

export class FakeProcessEngine implements ProcessEngine {
  readonly deployments = new Map<string, string>();
  /**
   * Decision table deployments, `<tenant>/<decisionKey>@<revisionId>`, in deployment order: the
   * last of a key is the one the engine runs.
   */
  readonly decisions: string[] = [];

  /** The table the tenant's decision tasks of `decisionKey` run, as the engine's highest version. */
  runningDecision(tenantId: string, decisionKey: string): string | undefined {
    return this.decisions.findLast((name) => name.startsWith(`${tenantId}/${decisionKey}@`));
  }

  private deployTable(tenant: TenantContext, decision: EngineDecision): void {
    const name = `${tenant.tenantId}/${decision.decisionKey}@${decision.revisionId}`;
    if (this.runningDecision(tenant.tenantId, decision.decisionKey) !== name) {
      this.decisions.push(name);
    }
  }
  readonly instances: Instance[] = [];
  readonly tasks: Task[] = [];
  readonly calls: string[] = [];
  /** The engine task ids `findTask` was asked for. */
  readonly foundTasks: string[] = [];
  /** Every call fails as unreachable. */
  down = false;
  /** The next call of this name does its work, then the answer is lost. */
  loseAnswerOf: keyof ProcessEngine | null = null;
  /** Deployments the engine refuses (an invalid model). */
  refuseDeployments = false;
  /** The user task a new instance reaches first. */
  firstTask: string | null = 'approve';
  #next = 0;
  /** Ids unique to this engine, so rows an earlier run left in the database never match. */
  readonly #run = randomUUID().slice(0, 8);

  constructor(private readonly clock: Clock) {}

  // --- what the model and operators do inside the engine ---

  openTask(instanceId: string, taskKey: string): string {
    const instance = this.instances.find((entry) => entry.id === instanceId)!;
    const id = `task-${this.#run}-${++this.#next}`;
    this.tasks.push({
      id,
      tenantId: instance.tenantId,
      instanceId,
      taskKey,
      formKey: `${taskKey}-form`,
      endedAt: null,
      deleteReason: null,
      completionKey: null,
      completedWith: null,
    });
    return id;
  }

  /** An interrupting boundary timer: the task is removed and an escalation task opens. */
  fireTimer(taskId: string): string {
    const task = this.task(taskId);
    task.endedAt = this.clock.now();
    task.deleteReason = 'boundary event (deadline)';
    return this.openTask(task.instanceId, 'escalate');
  }

  /** Someone completes the task in Flowable directly, without the core (PoC 3 R10). */
  completeBehindTheCore(taskId: string): void {
    const task = this.task(taskId);
    task.endedAt = this.clock.now();
    task.completedWith = {};
  }

  endInstance(instanceId: string, deleteReason: string | null = null): void {
    const instance = this.instances.find((entry) => entry.id === instanceId)!;
    instance.endedAt = this.clock.now();
    instance.deleteReason = deleteReason;
    for (const task of this.tasks) {
      if (task.instanceId === instanceId && task.endedAt === null) {
        task.endedAt = this.clock.now();
        task.deleteReason = deleteReason ?? 'instance ended';
      }
    }
  }

  /** A start that bypasses the find-before-start check: the lease overlap of PoC 3 F5c. */
  startDuplicate(tenantId: string, businessKey: string): string {
    return this.createInstance(tenantId, businessKey, businessKey).id;
  }

  liveInstancesOf(businessKey: string): Instance[] {
    return this.instances.filter((i) => i.businessKey === businessKey && i.endedAt === null);
  }

  openTasksOf(tenantId: string): Task[] {
    return this.tasks.filter((task) => task.tenantId === tenantId && task.endedAt === null);
  }

  // --- the port ---

  deployDecision(tenant: TenantContext, decision: EngineDecision): Promise<void> {
    return this.call('deployDecision', () => {
      if (this.refuseDeployments) throw new EngineRefusedError('client-error');
      this.deployTable(tenant, decision);
    });
  }

  deployRevision(tenant: TenantContext, deployment: EngineDeployment): Promise<void> {
    return this.call('deployRevision', () => {
      if (this.refuseDeployments) throw new EngineRefusedError('client-error');
      for (const decision of deployment.decisions) this.deployTable(tenant, decision);
      this.deployments.set(this.deploymentKey(tenant, deployment), tenant.tenantId);
    });
  }

  findInstancesByBusinessKey(tenant: TenantContext, businessKey: string) {
    return this.call('findInstancesByBusinessKey', () =>
      this.instances
        .filter((i) => i.tenantId === tenant.tenantId && i.businessKey === businessKey)
        .map(instanceOf),
    );
  }

  startInstance(tenant: TenantContext, command: StartCommand): Promise<EngineInstance> {
    return this.call('startInstance', () => {
      if (!this.deployments.has(this.deploymentKey(tenant, command))) {
        throw new EngineRefusedError('not-deployed');
      }
      const instance = this.createInstance(
        tenant.tenantId,
        command.businessKey,
        command.businessKey,
      );
      return instanceOf(instance);
    });
  }

  deleteInstance(tenant: TenantContext, engineInstanceId: string, reason: string) {
    return this.call('deleteInstance', () => {
      const instance = this.instances.find(
        (i) => i.id === engineInstanceId && i.tenantId === tenant.tenantId,
      );
      if (instance !== undefined && instance.endedAt === null) {
        this.endInstance(engineInstanceId, reason);
      }
    });
  }

  listOpenTasks(tenant: TenantContext): Promise<EngineOpenTask[]> {
    return this.call('listOpenTasks', () =>
      this.openTasksOf(tenant.tenantId).map((task) => this.openTaskOf(task)),
    );
  }

  listEndedTasks(tenant: TenantContext, after: Temporal.Instant | null, limit: number) {
    return this.call('listEndedTasks', () =>
      this.tasks
        .filter(
          (task) =>
            task.tenantId === tenant.tenantId &&
            task.endedAt !== null &&
            (after === null || task.endedAt.epochMilliseconds > after.epochMilliseconds),
        )
        .sort((a, b) => a.endedAt!.epochMilliseconds - b.endedAt!.epochMilliseconds)
        .slice(0, limit)
        .map((task) => this.recordOf(task)),
    );
  }

  listEndedInstances(tenant: TenantContext, after: Temporal.Instant | null, limit: number) {
    return this.call('listEndedInstances', () =>
      this.instances
        .filter(
          (i) =>
            i.tenantId === tenant.tenantId &&
            i.endedAt !== null &&
            (after === null || i.endedAt.epochMilliseconds > after.epochMilliseconds),
        )
        .sort((a, b) => a.endedAt!.epochMilliseconds - b.endedAt!.epochMilliseconds)
        .slice(0, limit)
        .map(instanceOf),
    );
  }

  findTask(tenant: TenantContext, engineTaskId: string): Promise<EngineTaskRecord | null> {
    return this.call('findTask', () => {
      this.foundTasks.push(engineTaskId);
      const task = this.tasks.find((t) => t.id === engineTaskId && t.tenantId === tenant.tenantId);
      return task === undefined ? null : this.recordOf(task);
    });
  }

  completeTask(
    tenant: TenantContext,
    engineTaskId: string,
    variables: EngineVariables,
    completionKey: string,
  ): Promise<'completed' | 'gone'> {
    return this.call('completeTask', () => {
      const task = this.tasks.find((t) => t.id === engineTaskId && t.tenantId === tenant.tenantId);
      if (task === undefined || task.endedAt !== null) return 'gone' as const;
      task.completionKey = completionKey;
      task.completedWith = variables;
      task.endedAt = this.clock.now();
      return 'completed' as const;
    });
  }

  // --- helpers ---

  private async call<T>(name: keyof ProcessEngine, work: () => T): Promise<T> {
    this.calls.push(name);
    if (this.down) throw new EngineUnavailableError('unreachable');
    const result = work();
    if (this.loseAnswerOf === name) {
      this.loseAnswerOf = null;
      throw new CallLostError(`the answer of ${name} was lost`);
    }
    return Promise.resolve(result);
  }

  private createInstance(tenantId: string, businessKey: string, coreInstanceId: string): Instance {
    const instance: Instance = {
      id: `instance-${this.#run}-${++this.#next}`,
      tenantId,
      businessKey,
      coreInstanceId,
      startedAt: this.clock.now(),
      endedAt: null,
      deleteReason: null,
    };
    this.instances.push(instance);
    if (this.firstTask !== null) this.openTask(instance.id, this.firstTask);
    return instance;
  }

  private task(id: string): Task {
    const task = this.tasks.find((entry) => entry.id === id);
    if (task === undefined) throw new Error(`no task ${id}`);
    return task;
  }

  private openTaskOf(task: Task): EngineOpenTask {
    const instance = this.instances.find((entry) => entry.id === task.instanceId)!;
    return {
      engineTaskId: task.id,
      engineInstanceId: task.instanceId,
      taskKey: task.taskKey,
      formKey: task.formKey,
      coreInstanceId: instance.coreInstanceId,
    };
  }

  private recordOf(task: Task): EngineTaskRecord {
    return {
      ...this.openTaskOf(task),
      endedAt: task.endedAt,
      end:
        task.endedAt === null
          ? null
          : task.deleteReason !== null
            ? { kind: 'deleted', reason: task.deleteReason }
            : { kind: 'completed', completionKey: task.completionKey },
    };
  }

  private deploymentKey(
    tenant: TenantContext,
    deployment: Pick<EngineDeployment, 'processKey' | 'revisionId'>,
  ): string {
    return `${tenant.tenantId}/${deployment.processKey}@${deployment.revisionId}`;
  }
}

function instanceOf(instance: Instance): EngineInstance {
  return {
    engineInstanceId: instance.id,
    businessKey: instance.businessKey,
    startedAt: instance.startedAt,
    endedAt: instance.endedAt,
    deleted: instance.deleteReason !== null,
  };
}
