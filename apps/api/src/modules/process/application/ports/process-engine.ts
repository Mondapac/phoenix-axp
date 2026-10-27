import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { EngineVariables } from '../../domain/engine-command';
import type { EngineTaskEnd } from '../../domain/task';

/**
 * The process engine as the process module sees it (ADR-0005 decision 2): the only door to
 * Flowable. Every call names one tenant; the adapter passes it on the wire and refuses any
 * object of another tenant, or another id or business key than asked for, with
 * {@link EngineTenantMismatchError} (ADR-0020 decision 6). Calls are made outside any unit.
 *
 * The engine has no idempotency keys of its own, so the caller makes each command idempotent:
 * a deployment by its name, a start by its business key (the core instance id), a completion
 * by the completion key stored on the task before it is completed.
 */
export interface ProcessEngine {
  /** Deploys a revision to the tenant once, named `<processKey>@<revisionId>`; a repeat is a no-op. */
  deployRevision(tenant: TenantContext, deployment: EngineDeployment): Promise<void>;
  /** Every instance with this business key, running or ended, oldest first. */
  findInstancesByBusinessKey(tenant: TenantContext, businessKey: string): Promise<EngineInstance[]>;
  /** Starts exactly the deployment of the revision, never "the latest" (ADR-0007 V3). */
  startInstance(tenant: TenantContext, command: StartCommand): Promise<EngineInstance>;
  /** Removes a running instance; one that is gone already is not an error. */
  deleteInstance(tenant: TenantContext, engineInstanceId: string, reason: string): Promise<void>;
  /** Every open user task of the tenant. */
  listOpenTasks(tenant: TenantContext): Promise<EngineOpenTask[]>;
  /** User tasks that ended after `after` (all when null), by end time, at most `limit`. */
  listEndedTasks(
    tenant: TenantContext,
    after: Temporal.Instant | null,
    limit: number,
  ): Promise<EngineTaskRecord[]>;
  /** Instances that ended after `after` (all when null), by end time, at most `limit`. */
  listEndedInstances(
    tenant: TenantContext,
    after: Temporal.Instant | null,
    limit: number,
  ): Promise<EngineInstance[]>;
  /** A task's history record, or null when the engine does not know it. */
  findTask(tenant: TenantContext, engineTaskId: string): Promise<EngineTaskRecord | null>;
  /**
   * Stores `completionKey` on the task, then completes it with `variables`. `gone` when the
   * task no longer runs (completed before, or removed by a timer).
   */
  completeTask(
    tenant: TenantContext,
    engineTaskId: string,
    variables: EngineVariables,
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
  readonly revisionId: string;
  /** The core instance id: the business key and the `phoenixInstanceId` variable. */
  readonly businessKey: string;
  readonly variables: EngineVariables;
}

export interface EngineInstance {
  readonly engineInstanceId: string;
  readonly businessKey: string | null;
  /** The engine's clock. */
  readonly startedAt: Temporal.Instant;
  readonly endedAt: Temporal.Instant | null;
  /** Ended by deletion (an operator, or the core removing an orphan), not by an end event. */
  readonly deleted: boolean;
}

export interface EngineOpenTask {
  readonly engineTaskId: string;
  readonly engineInstanceId: string;
  readonly taskKey: string;
  readonly formKey: string | null;
  /** The instance's `phoenixInstanceId` variable; null for an instance the core did not start. */
  readonly coreInstanceId: string | null;
}

export interface EngineTaskRecord extends EngineOpenTask {
  readonly endedAt: Temporal.Instant | null;
  /** How it ended, or null while it is open. */
  readonly end: EngineTaskEnd | null;
}

/** The engine did not answer usefully (refused connection, timeout, 5xx): try again later. */
export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError';
  constructor(
    readonly reason: 'unconfigured' | 'unreachable' | 'timeout' | 'server-error' | 'too-many',
  ) {
    super(`The process engine is unavailable: ${reason}`);
  }
}

/**
 * The command is refused for good: an invalid model, a missing definition, a 4xx, or a stored
 * model the current intake check refuses (`model-refused`; it never reaches the engine).
 */
export class EngineRefusedError extends Error {
  override readonly name = 'EngineRefusedError';
  constructor(readonly reason: 'not-deployed' | 'client-error' | 'model-refused') {
    super(`The process engine refused the command: ${reason}`);
  }
}

/** The engine returned an object of another tenant, or not the one asked for: always a defect. */
export class EngineTenantMismatchError extends Error {
  override readonly name = 'EngineTenantMismatchError';
  constructor() {
    super('The process engine returned an object of another tenant or another id');
  }
}

/** Nest token of the {@link ProcessEngine} port. */
export const PROCESS_ENGINE = Symbol('PROCESS_ENGINE');
