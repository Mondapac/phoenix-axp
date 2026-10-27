import type { Id, JsonObject, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { CommandKind } from '../domain/engine-command';
import type { IncidentKind } from '../domain/incident';
import type { InstanceStatus } from '../domain/instance';
import type { TaskStatus } from '../domain/task';

// The process module's persistence port. Every method runs inside the caller's open unit, on
// the unit's tenant; writes that race are conditional (a version, a null column, an attempts
// count) and answer whether they won.

export interface RevisionRecord {
  readonly id: Id<'ProcessRevision'>;
  readonly processKey: string;
  readonly revision: number;
  readonly bpmnXml: string;
}

export interface InstanceRecord {
  readonly id: Id<'ProcessInstance'>;
  readonly revisionId: Id<'ProcessRevision'>;
  readonly status: InstanceStatus;
  readonly engineInstanceId: string | null;
  readonly version: number;
}

export interface TaskRecord {
  readonly id: Id<'ProcessTask'>;
  readonly instanceId: Id<'ProcessInstance'>;
  readonly engineTaskId: string;
  readonly taskKey: string;
  readonly formKey: string | null;
  readonly status: TaskStatus;
  readonly completionKey: string | null;
  readonly version: number;
}

export interface NewCommand {
  readonly id: Id<'EngineCommand'>;
  readonly kind: CommandKind;
  readonly subjectId: string;
  readonly payload: JsonObject;
  readonly correlationId: string;
}

export interface CommandRecord extends NewCommand {
  readonly attempts: number;
}

export interface IncidentRecord {
  readonly id: Id<'ProcessIncident'>;
  readonly kind: IncidentKind;
  readonly engineRef: string;
  readonly instanceId: Id<'ProcessInstance'> | null;
  readonly detectedAt: Temporal.Instant;
}

export interface SyncState {
  readonly tasksEndedAfter: Temporal.Instant | null;
  readonly instancesEndedAfter: Temporal.Instant | null;
  /** 0 when the tenant has no row yet. */
  readonly version: number;
}

export interface ProcessRepository {
  latestRevisionNumber(tenant: TenantContext, processKey: string): Promise<number>;
  insertRevision(
    tenant: TenantContext,
    revision: RevisionRecord & { readonly contentHash: string },
    at: Temporal.Instant,
  ): Promise<void>;
  findRevision(tenant: TenantContext, id: string): Promise<RevisionRecord | null>;

  insertInstance(
    tenant: TenantContext,
    instance: { readonly id: Id<'ProcessInstance'>; readonly revisionId: Id<'ProcessRevision'> },
    at: Temporal.Instant,
  ): Promise<void>;
  findInstance(tenant: TenantContext, id: string): Promise<InstanceRecord | null>;
  /**
   * Records `engineInstanceId` as the instance's engine instance if none is recorded yet (first
   * writer wins) and answers the engine instance recorded after the call.
   */
  adoptEngineInstance(
    tenant: TenantContext,
    id: Id<'ProcessInstance'>,
    engineInstanceId: string,
  ): Promise<string | null>;
  /** Ends a running instance; false when it is not running (ended already, or still starting). */
  endInstance(
    tenant: TenantContext,
    id: Id<'ProcessInstance'>,
    status: InstanceStatus,
    at: Temporal.Instant,
  ): Promise<boolean>;

  /** Inserts a task seen open, or seen only after it ended (closed at `at` then). */
  insertTask(
    tenant: TenantContext,
    task: Omit<TaskRecord, 'version' | 'completionKey'>,
    at: Temporal.Instant,
  ): Promise<void>;
  findTask(tenant: TenantContext, id: string): Promise<TaskRecord | null>;
  findTaskByEngineId(tenant: TenantContext, engineTaskId: string): Promise<TaskRecord | null>;
  /** Open and completing tasks, oldest first, after `afterId`, at most `limit`. */
  openTasks(
    tenant: TenantContext,
    afterId: string | null,
    limit: number,
  ): Promise<TaskRecord[]>;
  /** Moves an open task to `completing` with its key; false when its version moved. */
  markCompleting(
    tenant: TenantContext,
    task: TaskRecord,
    completionKey: Id<'EngineCommand'>,
  ): Promise<boolean>;
  /** Closes a task with `status`; false when its version moved. */
  closeTask(
    tenant: TenantContext,
    task: TaskRecord,
    status: TaskStatus,
    at: Temporal.Instant,
  ): Promise<boolean>;

  insertCommand(tenant: TenantContext, command: NewCommand, at: Temporal.Instant): Promise<void>;
  /** Commands due at `now`, oldest first: unpublished, alive and past their lease or retry. */
  dueCommands(tenant: TenantContext, now: Temporal.Instant, limit: number): Promise<CommandRecord[]>;
  /**
   * The claim (ADR-0020 decision 7): a compare-and-set on `attempts` that takes the lease until
   * `leaseUntil`. False when another relay claimed it first.
   */
  claimCommand(
    tenant: TenantContext,
    command: CommandRecord,
    leaseUntil: Temporal.Instant,
  ): Promise<boolean>;
  /** Marks a claimed command published. */
  ackCommand(tenant: TenantContext, id: string, at: Temporal.Instant): Promise<void>;
  /** Gives a claimed command back, due again at `retryAt`, with the failure code. */
  releaseCommand(
    tenant: TenantContext,
    command: CommandRecord,
    retryAt: Temporal.Instant,
    error: string,
  ): Promise<void>;
  /** Ends a command the engine refused for good. */
  killCommand(
    tenant: TenantContext,
    id: string,
    at: Temporal.Instant,
    error: string,
  ): Promise<void>;

  /** Records an observation for `handler`; false when it was recorded before (a repeat). */
  recordObservation(
    tenant: TenantContext,
    eventId: string,
    handler: string,
    at: Temporal.Instant,
  ): Promise<boolean>;

  readSyncState(tenant: TenantContext): Promise<SyncState>;
  /** Saves the watermarks if `expectedVersion` still holds; false when another pass saved first. */
  saveSyncState(
    tenant: TenantContext,
    state: Omit<SyncState, 'version'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<boolean>;

  /** Records an incident once per kind and engine object; a repeat changes nothing. */
  recordIncident(tenant: TenantContext, incident: IncidentRecord): Promise<void>;
  /** The latest incidents first, at most `limit`. */
  latestIncidents(tenant: TenantContext, limit: number): Promise<IncidentRecord[]>;
}

/** Nest token of the {@link ProcessRepository} port. */
export const PROCESS_REPOSITORY = Symbol('PROCESS_REPOSITORY');
