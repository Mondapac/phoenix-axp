import type { TenantContext } from '@phoenix/shared-kernel';
import type { Decision, EngineTaskEnd } from '../../domain/task';

/**
 * The process engine as the `process` module sees it (ADR-0005 decision 2): the only door to
 * Flowable. Every call names one tenant, and the adapter refuses any engine object of another
 * tenant ({@link EngineTenantMismatchError}). Calls are made outside any unit of work.
 *
 * The engine has no idempotency keys of its own, so each command is made idempotent by the
 * caller: a start by its business key (the request id), a completion by the completion key
 * stored as a task-local variable before the task is completed.
 */
export interface ProcessEngine {
  /** Deploys a process revision to the tenant once (by deployment name); repeating is a no-op. */
  deployRevision(tenant: TenantContext, revision: EngineDeployment): Promise<void>;
  /** Every instance, running or ended, with this business key, oldest first. */
  findInstancesByBusinessKey(tenant: TenantContext, businessKey: string): Promise<EngineInstance[]>;
  startInstance(tenant: TenantContext, command: StartCommand): Promise<EngineInstance>;
  findInstance(tenant: TenantContext, instanceId: string): Promise<EngineInstance | null>;
  /** Removes an instance; one that is already gone is not an error. */
  deleteInstance(tenant: TenantContext, instanceId: string, reason: string): Promise<void>;
  /** Every open user task of the tenant, with the request id it carries. */
  listOpenTasks(tenant: TenantContext): Promise<EngineOpenTask[]>;
  /** A task's history record: how it ended, or `end: null` while it is open. */
  findTask(tenant: TenantContext, engineTaskId: string): Promise<EngineTaskRecord | null>;
  /** Every task the instance ever had, open or ended (history). */
  listInstanceTasks(tenant: TenantContext, instanceId: string): Promise<EngineTaskRecord[]>;
  /**
   * Stores `completionKey` on the task, then completes it with `decision`. `gone` when the task
   * no longer exists in the runtime (completed before, or removed by a timer).
   */
  completeTask(
    tenant: TenantContext,
    engineTaskId: string,
    decision: Decision,
    completionKey: string,
  ): Promise<'completed' | 'gone'>;
}

export interface EngineDeployment {
  readonly processKey: string;
  readonly revisionId: string;
  readonly bpmnXml: string;
}

export interface StartCommand {
  readonly processKey: string;
  /** The core's process revision: the instance runs exactly the deployment of it (V3). */
  readonly revisionId: string;
  /** The request id: the idempotency key of the start. */
  readonly businessKey: string;
  /** Ids and routing values only (ADR-0005 decision 7). */
  readonly variables: Readonly<Record<string, string>>;
}

export interface EngineInstance {
  readonly instanceId: string;
  readonly businessKey: string | null;
  /** ISO-8601, the engine's clock. */
  readonly startedAt: string;
  readonly ended: boolean;
  /** Ended by deletion (an operator, or the core removing an orphan), not by its end event. */
  readonly deleted: boolean;
  readonly decision: Decision | null;
}

export interface EngineOpenTask {
  readonly engineTaskId: string;
  readonly processInstanceId: string;
  readonly taskKey: string;
  readonly formKey: string | null;
  readonly assigneeId: string | null;
  /** The `requestId` process variable; null for a task the core did not start. */
  readonly requestId: string | null;
}

export interface EngineTaskRecord {
  readonly engineTaskId: string;
  readonly processInstanceId: string;
  readonly taskKey: string;
  readonly formKey: string | null;
  readonly assigneeId: string | null;
  readonly end: EngineTaskEnd | null;
}

/** The engine did not answer usefully (refused, timed out, 5xx): try again later. */
export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError';
  constructor(readonly reason: 'unreachable' | 'timeout' | 'server-error' | 'unexpected-status') {
    super(`The process engine is unavailable: ${reason}`);
  }
}

/** The engine returned an object of another tenant: never used, always a defect. */
export class EngineTenantMismatchError extends Error {
  override readonly name = 'EngineTenantMismatchError';
  constructor() {
    super('The process engine returned an object of another tenant');
  }
}
