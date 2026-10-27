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
  /** Null for a tenant-level run. */
  readonly siteId: Id<'Site'> | null;
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
  // The inbox (slice 2.3, ADR-0025).
  readonly siteId: Id<'Site'> | null;
  readonly name: string | null;
  readonly candidateRoleId: Id<'Role'> | null;
  readonly assigneeAccountId: Id<'Account'> | null;
  readonly dueAt: Temporal.Instant | null;
  readonly escalationRoleId: Id<'Role'> | null;
  readonly escalatedAt: Temporal.Instant | null;
  readonly outcomes: readonly string[];
  readonly outcome: string | null;
  readonly openedAt: Temporal.Instant;
}

/** A task as the sync first records it. */
export type NewTask = Omit<
  TaskRecord,
  'version' | 'completionKey' | 'escalatedAt' | 'outcome' | 'openedAt'
>;

/** A revision's stored task settings: task key to attributes, checked again when read. */
export type StoredTaskSettings = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A tenant's working calendar as stored; version 0 when the tenant entered none. */
export interface CalendarRecord {
  readonly weekendDays: readonly number[];
  /** ISO dates, sorted. */
  readonly holidays: readonly string[];
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
    revision: RevisionRecord & {
      readonly contentHash: string;
      readonly taskSettings: StoredTaskSettings;
    },
    at: Temporal.Instant,
  ): Promise<void>;
  findRevision(tenant: TenantContext, id: string): Promise<RevisionRecord | null>;
  /** The task settings of a revision; null when the revision does not exist. */
  findTaskSettings(tenant: TenantContext, revisionId: string): Promise<StoredTaskSettings | null>;

  insertInstance(
    tenant: TenantContext,
    instance: {
      readonly id: Id<'ProcessInstance'>;
      readonly revisionId: Id<'ProcessRevision'>;
      readonly siteId: Id<'Site'> | null;
    },
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
  insertTask(tenant: TenantContext, task: NewTask, at: Temporal.Instant): Promise<void>;
  findTask(tenant: TenantContext, id: string): Promise<TaskRecord | null>;
  findTaskByEngineId(tenant: TenantContext, engineTaskId: string): Promise<TaskRecord | null>;
  /** Open and completing tasks, oldest first, after `afterId`, at most `limit`. */
  openTasks(tenant: TenantContext, afterId: string | null, limit: number): Promise<TaskRecord[]>;
  /**
   * Moves an open task to `completing` with its key, held by `assignee` (an implicit claim)
   * when given, with the outcome picked; false when its version moved.
   */
  markCompleting(
    tenant: TenantContext,
    task: TaskRecord,
    completionKey: Id<'EngineCommand'>,
    completion: {
      readonly assigneeAccountId: Id<'Account'> | null;
      readonly outcome: string | null;
    },
  ): Promise<boolean>;
  /** Gives an open task to `assignee` (null: back to its queue); false when its version moved. */
  assignTask(
    tenant: TenantContext,
    task: TaskRecord,
    assigneeAccountId: Id<'Account'> | null,
  ): Promise<boolean>;
  /**
   * The deadline passed: an open or completing task moves, open, to the escalation role's
   * queue, held by nobody, its completion request dropped; false when its version moved.
   */
  escalateTask(tenant: TenantContext, task: TaskRecord, at: Temporal.Instant): Promise<boolean>;
  /**
   * The inbox candidates of an account: open and completing tasks it holds, and open tasks
   * nobody holds in the queues of `roleIds`; by due time (none last), then age, at most `limit`.
   */
  inboxCandidates(
    tenant: TenantContext,
    accountId: Id<'Account'>,
    roleIds: readonly Id<'Role'>[],
    limit: number,
  ): Promise<TaskRecord[]>;
  /** Open and completing tasks by due time (none last), then age, at most `limit`. */
  openTasksByDue(tenant: TenantContext, limit: number): Promise<TaskRecord[]>;
  /** Open tasks whose deadline escalates and has passed at `now`, oldest due first. */
  tasksToEscalate(
    tenant: TenantContext,
    now: Temporal.Instant,
    limit: number,
  ): Promise<TaskRecord[]>;
  /** Closes a task with `status`; false when its version moved. */
  closeTask(
    tenant: TenantContext,
    task: TaskRecord,
    status: TaskStatus,
    at: Temporal.Instant,
  ): Promise<boolean>;

  insertCommand(tenant: TenantContext, command: NewCommand, at: Temporal.Instant): Promise<void>;
  /** Commands due at `now`, oldest first: unpublished, alive and past their lease or retry. */
  dueCommands(
    tenant: TenantContext,
    now: Temporal.Instant,
    limit: number,
  ): Promise<CommandRecord[]>;
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

  readWorkingCalendar(tenant: TenantContext): Promise<CalendarRecord>;
  /** Saves the calendar if `expectedVersion` still holds; false when another write came first. */
  saveWorkingCalendar(
    tenant: TenantContext,
    calendar: Omit<CalendarRecord, 'version'>,
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
