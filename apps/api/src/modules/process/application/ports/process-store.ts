import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { RequestStatus } from '../../domain/request';
import type { Decision, IncidentKind, TaskStatus } from '../../domain/task';

/**
 * The module's persistence (spike: one port for every table of schema `process`). Every method
 * runs inside the caller's unit of work and names the unit's tenant.
 */
export interface ProcessStore {
  latestFormRevision(tenant: TenantContext, formKey: string): Promise<FormRevisionRecord | null>;
  latestProcessRevision(
    tenant: TenantContext,
    processKey: string,
  ): Promise<ProcessRevisionRecord | null>;
  findProcessRevision(
    tenant: TenantContext,
    revisionId: string,
  ): Promise<ProcessRevisionRecord | null>;
  insertFormRevision(tenant: TenantContext, record: FormRevisionRecord): Promise<void>;
  insertProcessRevision(tenant: TenantContext, record: ProcessRevisionRecord): Promise<void>;

  insertRequest(tenant: TenantContext, record: RequestRecord): Promise<void>;
  findRequest(tenant: TenantContext, requestId: string): Promise<RequestRecord | null>;
  /** Requests still waiting for their instance to end. */
  runningRequests(tenant: TenantContext): Promise<RequestRecord[]>;
  /** Sets the instance only when none is set (first writer wins); answers the stored one. */
  adoptInstance(
    tenant: TenantContext,
    requestId: string,
    instanceId: string,
  ): Promise<string | null>;
  closeRequest(tenant: TenantContext, requestId: string, status: RequestStatus): Promise<boolean>;

  /** `exists` when the engine task is already in the inbox (unique per tenant). */
  insertTask(tenant: TenantContext, record: TaskRecord): Promise<'inserted' | 'exists'>;
  findTask(tenant: TenantContext, taskId: string): Promise<TaskRecord | null>;
  /** Tasks matching every given filter (`statuses`, one assignee, one request). */
  tasks(
    tenant: TenantContext,
    filter: {
      readonly statuses?: readonly TaskStatus[];
      readonly assigneeId?: string;
      readonly requestId?: string;
    },
  ): Promise<TaskRecord[]>;
  /** Compare-and-set on `version`; false when another writer got there first. */
  updateTask(
    tenant: TenantContext,
    taskId: string,
    expectedVersion: number,
    patch: TaskPatch,
  ): Promise<boolean>;

  appendOutbox(tenant: TenantContext, row: OutboxRecord): Promise<void>;
  /** Claims up to `limit` due rows with a lease until `leaseUntil` (compare-and-set). */
  claimOutbox(
    tenant: TenantContext,
    now: Temporal.Instant,
    leaseUntil: Temporal.Instant,
    limit: number,
  ): Promise<ClaimedCommand[]>;
  /** Publishes a claimed row; false when the lease was lost to another claim. */
  ackOutbox(tenant: TenantContext, claim: ClaimedCommand, now: Temporal.Instant): Promise<boolean>;
  /** Gives a claimed row back for a later attempt. */
  releaseOutbox(
    tenant: TenantContext,
    claim: ClaimedCommand,
    retryAt: Temporal.Instant,
    errorCode: string,
  ): Promise<void>;

  /** Inserts `(event_id, handler)`; false when it was there already (a duplicate delivery). */
  recordInInbox(
    tenant: TenantContext,
    eventId: string,
    handler: string,
    now: Temporal.Instant,
  ): Promise<boolean>;
  recordIncident(tenant: TenantContext, incident: IncidentRecord): Promise<void>;
}

export interface FormRevisionRecord {
  readonly id: Id<'FormRevision'>;
  readonly formKey: string;
  readonly revision: number;
  readonly jsonSchema: object;
  readonly uiSchema: object;
  readonly contentHash: string;
  readonly publishedAt: Temporal.Instant;
}

export interface ProcessRevisionRecord {
  readonly id: Id<'ProcessRevision'>;
  readonly processKey: string;
  readonly revision: number;
  readonly bpmnXml: string;
  readonly contentHash: string;
  readonly publishedAt: Temporal.Instant;
}

export interface RequestRecord {
  readonly id: Id<'Request'>;
  readonly requesterId: string;
  readonly formRevisionId: string;
  readonly processRevisionId: string;
  readonly answers: object;
  readonly contentHash: string;
  readonly status: RequestStatus;
  readonly processInstanceId: string | null;
  readonly submittedAt: Temporal.Instant;
  readonly version: number;
}

export interface TaskRecord {
  readonly id: Id<'Task'>;
  readonly requestId: string;
  readonly engineTaskId: string;
  readonly taskKey: string;
  readonly formKey: string;
  readonly assigneeId: string;
  readonly status: TaskStatus;
  readonly decision: Decision | null;
  readonly completionKey: string | null;
  readonly openedAt: Temporal.Instant;
  readonly closedAt: Temporal.Instant | null;
  readonly version: number;
}

export type TaskPatch = Partial<
  Pick<TaskRecord, 'status' | 'decision' | 'completionKey' | 'closedAt'>
>;

export interface OutboxRecord {
  readonly eventId: Id<'event'>;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: Temporal.Instant;
  readonly correlationId: string;
  readonly payload: object;
}

/** A row the relay holds a lease on; `attempts` is the value its claim wrote. */
export interface ClaimedCommand {
  readonly eventId: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
}

export interface IncidentRecord {
  readonly id: Id<'Incident'>;
  readonly kind: IncidentKind;
  readonly engineRef: string;
  readonly requestId: string | null;
  readonly detectedAt: Temporal.Instant;
}
