import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { Id, JsonObject, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  CalendarRecord,
  CommandRecord,
  FormBinding,
  IncidentRecord,
  InstanceRecord,
  NewCommand,
  NewTask,
  ProcessRepository,
  RevisionRecord,
  StartingRevision,
  StoredTaskSettings,
  SyncState,
  TaskRecord,
  TaskSites,
} from '../application/process.repository';
import type { CommandKind } from '../domain/engine-command';
import type { IncidentKind } from '../domain/incident';
import type { InstanceStatus } from '../domain/instance';
import { OPEN_TASK_STATUSES, type TaskStatus } from '../domain/task';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

const TASK_COLUMNS = {
  id: true,
  instanceId: true,
  engineTaskId: true,
  taskKey: true,
  formKey: true,
  formRevisionId: true,
  status: true,
  completionKey: true,
  version: true,
  siteId: true,
  name: true,
  candidateRoleId: true,
  assigneeAccountId: true,
  dueAt: true,
  escalationRoleId: true,
  escalatedAt: true,
  outcomes: true,
  outcome: true,
  openedAt: true,
} as const;

/** By due time, none last, then age: the order of an inbox. */
const INBOX_ORDER = [
  { dueAt: { sort: 'asc', nulls: 'last' } },
  { openedAt: 'asc' },
  { id: 'asc' },
] as const;

/** An ISO date as PostgreSQL `date` reads it through Prisma, and back. */
const dayOf = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (day: Date): string => day.toISOString().slice(0, 10);

/** Every site, or the listed ones (a task without a site matches no list). */
const siteFilterOf = (sites: TaskSites) => (sites === 'all' ? {} : { siteId: { in: [...sites] } });

/** The process module's tables in schema `process`, through the unit's guarded client. */
@Injectable()
export class PrismaProcessRepository implements ProcessRepository {
  constructor(private readonly prisma: PrismaService) {}

  async latestRevisionNumber(tenant: TenantContext, processKey: string): Promise<number> {
    const latest = await this.prisma.tx(tenant).processRevision.findFirst({
      where: { tenantId: tenant.tenantId, processKey },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    return latest?.revision ?? 0;
  }

  async insertRevision(
    tenant: TenantContext,
    revision: RevisionRecord & {
      readonly contentHash: string;
      readonly taskSettings: StoredTaskSettings;
    },
    at: Temporal.Instant,
  ): Promise<void> {
    // Two publishes of one key read the same latest number: the second insert waits for the
    // first and then inserts nothing, which is a stale read (409 conflict.stale), never a 500.
    const { count } = await this.prisma.tx(tenant).processRevision.createMany({
      data: [
        {
          tenantId: tenant.tenantId,
          id: revision.id,
          processKey: revision.processKey,
          revision: revision.revision,
          bpmnXml: revision.bpmnXml,
          contentHash: revision.contentHash,
          taskSettings: revision.taskSettings,
          publishedAt: dateOf(at),
        },
      ],
      skipDuplicates: true,
    });
    if (count !== 1) throw new StaleAggregateError('ProcessRevision', revision.processKey);
  }

  async findRevision(tenant: TenantContext, id: string): Promise<RevisionRecord | null> {
    const row = await this.prisma.tx(tenant).processRevision.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: { id: true, processKey: true, revision: true, bpmnXml: true },
    });
    return row === null ? null : { ...row, id: row.id as Id<'ProcessRevision'> };
  }

  async findTaskSettings(
    tenant: TenantContext,
    revisionId: string,
  ): Promise<StoredTaskSettings | null> {
    const row = await this.prisma.tx(tenant).processRevision.findUnique({
      where: {
        tenantId_id: { tenantId: tenant.tenantId, id: revisionId },
        tenantId: tenant.tenantId,
      },
      select: { taskSettings: true },
    });
    if (row === null) return null;
    const settings = row.taskSettings;
    // The column CHECK keeps it an object; anything else reads as no settings.
    return typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as StoredTaskSettings)
      : {};
  }

  async insertInstance(
    tenant: TenantContext,
    instance: {
      readonly id: Id<'ProcessInstance'>;
      readonly revisionId: Id<'ProcessRevision'>;
      readonly siteId: Id<'Site'> | null;
      readonly submissionId?: Id<'FormSubmission'> | null;
    },
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).processInstance.create({
      data: {
        tenantId: tenant.tenantId,
        id: instance.id,
        revisionId: instance.revisionId,
        siteId: instance.siteId,
        submissionId: instance.submissionId ?? null,
        status: 'starting',
        engineInstanceId: null,
        requestedAt: dateOf(at),
        endedAt: null,
        version: 1,
      },
    });
  }

  async findInstance(tenant: TenantContext, id: string): Promise<InstanceRecord | null> {
    const row = await this.prisma.tx(tenant).processInstance.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: {
        id: true,
        revisionId: true,
        siteId: true,
        status: true,
        engineInstanceId: true,
        version: true,
      },
    });
    return row === null
      ? null
      : {
          ...row,
          id: row.id as Id<'ProcessInstance'>,
          revisionId: row.revisionId as Id<'ProcessRevision'>,
          siteId: row.siteId as Id<'Site'> | null,
          status: row.status as InstanceStatus,
        };
  }

  async adoptEngineInstance(
    tenant: TenantContext,
    id: Id<'ProcessInstance'>,
    engineInstanceId: string,
  ): Promise<string | null> {
    const tx = this.prisma.tx(tenant);
    // First writer wins: only a row with no engine instance yet takes this one.
    await tx.processInstance.updateMany({
      where: { tenantId: tenant.tenantId, id, engineInstanceId: null, status: 'starting' },
      data: { engineInstanceId, status: 'running', version: { increment: 1 } },
    });
    const row = await tx.processInstance.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: { engineInstanceId: true },
    });
    return row?.engineInstanceId ?? null;
  }

  async endInstance(
    tenant: TenantContext,
    id: Id<'ProcessInstance'>,
    status: InstanceStatus,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).processInstance.updateMany({
      where: { tenantId: tenant.tenantId, id, status: 'running' },
      data: { status, endedAt: dateOf(at), version: { increment: 1 } },
    });
    return count === 1;
  }

  async insertTask(tenant: TenantContext, task: NewTask, at: Temporal.Instant): Promise<void> {
    const open = OPEN_TASK_STATUSES.includes(task.status);
    await this.prisma.tx(tenant).processTask.create({
      data: {
        tenantId: tenant.tenantId,
        id: task.id,
        instanceId: task.instanceId,
        engineTaskId: task.engineTaskId,
        taskKey: task.taskKey,
        formKey: task.formKey,
        formRevisionId: task.formRevisionId,
        status: task.status,
        completionKey: null,
        siteId: task.siteId,
        name: task.name,
        candidateRoleId: task.candidateRoleId,
        assigneeAccountId: task.assigneeAccountId,
        dueAt: task.dueAt === null ? null : dateOf(task.dueAt),
        escalationRoleId: task.escalationRoleId,
        escalatedAt: null,
        outcomes: [...task.outcomes],
        outcome: null,
        openedAt: dateOf(at),
        closedAt: open ? null : dateOf(at),
        version: 1,
      },
    });
  }

  async taskFormRevision(
    tenant: TenantContext,
    revisionId: Id<'ProcessRevision'>,
    taskKey: string,
  ): Promise<Id<'FormRevision'> | null> {
    const row = await this.prisma.tx(tenant).processFormBinding.findUnique({
      where: {
        tenantId_revisionId_elementId: {
          tenantId: tenant.tenantId,
          revisionId,
          elementId: taskKey,
        },
        tenantId: tenant.tenantId,
      },
      select: { kind: true, formRevisionId: true },
    });
    return row?.kind === 'task' ? (row.formRevisionId as Id<'FormRevision'>) : null;
  }

  async insertFormBindings(
    tenant: TenantContext,
    revisionId: Id<'ProcessRevision'>,
    bindings: readonly FormBinding[],
  ): Promise<void> {
    if (bindings.length === 0) return;
    await this.prisma.tx(tenant).processFormBinding.createMany({
      data: bindings.map((binding) => ({
        tenantId: tenant.tenantId,
        revisionId,
        elementId: binding.elementId,
        kind: binding.kind,
        formId: binding.formId,
        formRevisionId: binding.formRevisionId,
      })),
    });
  }

  async claimStartForm(
    tenant: TenantContext,
    formId: Id<'Form'>,
    processKey: string,
    at: Temporal.Instant,
  ): Promise<string> {
    const tx = this.prisma.tx(tenant);
    // ON CONFLICT DO NOTHING: a second claim waits for the first and then inserts nothing.
    await tx.processStartForm.createMany({
      data: [{ tenantId: tenant.tenantId, formId, processKey, claimedAt: dateOf(at) }],
      skipDuplicates: true,
    });
    const row = await tx.processStartForm.findUniqueOrThrow({
      where: { tenantId_formId: { tenantId: tenant.tenantId, formId }, tenantId: tenant.tenantId },
      select: { processKey: true },
    });
    return row.processKey;
  }

  async startingRevision(
    tenant: TenantContext,
    formId: Id<'Form'>,
  ): Promise<StartingRevision | null> {
    const tx = this.prisma.tx(tenant);
    const claim = await tx.processStartForm.findUnique({
      where: { tenantId_formId: { tenantId: tenant.tenantId, formId }, tenantId: tenant.tenantId },
      select: { processKey: true },
    });
    if (claim === null) return null;
    const latest = await tx.processRevision.findFirst({
      where: { tenantId: tenant.tenantId, processKey: claim.processKey },
      orderBy: { revision: 'desc' },
      select: { id: true },
    });
    if (latest === null) return null;
    const start = await tx.processFormBinding.findFirst({
      where: { tenantId: tenant.tenantId, revisionId: latest.id, kind: 'start', formId },
      select: { formRevisionId: true },
    });
    return start === null
      ? null
      : {
          id: latest.id as Id<'ProcessRevision'>,
          formRevisionId: start.formRevisionId as Id<'FormRevision'>,
        };
  }

  async hasInstanceFromSubmission(
    tenant: TenantContext,
    submissionId: Id<'FormSubmission'>,
  ): Promise<boolean> {
    const row = await this.prisma.tx(tenant).processInstance.findUnique({
      where: {
        tenantId_submissionId: { tenantId: tenant.tenantId, submissionId },
        tenantId: tenant.tenantId,
      },
      select: { id: true },
    });
    return row !== null;
  }

  async findTask(tenant: TenantContext, id: string): Promise<TaskRecord | null> {
    const row = await this.prisma.tx(tenant).processTask.findUnique({
      where: { id, tenantId: tenant.tenantId },
      select: TASK_COLUMNS,
    });
    return row === null ? null : taskOf(row);
  }

  async findTaskByEngineId(
    tenant: TenantContext,
    engineTaskId: string,
  ): Promise<TaskRecord | null> {
    const row = await this.prisma.tx(tenant).processTask.findUnique({
      where: {
        tenantId_engineTaskId: { tenantId: tenant.tenantId, engineTaskId },
        tenantId: tenant.tenantId,
      },
      select: TASK_COLUMNS,
    });
    return row === null ? null : taskOf(row);
  }

  async openTasks(
    tenant: TenantContext,
    afterId: string | null,
    limit: number,
  ): Promise<TaskRecord[]> {
    const rows = await this.prisma.tx(tenant).processTask.findMany({
      where: {
        tenantId: tenant.tenantId,
        status: { in: [...OPEN_TASK_STATUSES] },
        ...(afterId === null ? {} : { id: { gt: afterId } }),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: TASK_COLUMNS,
    });
    return rows.map(taskOf);
  }

  async markCompleting(
    tenant: TenantContext,
    task: TaskRecord,
    completionKey: Id<'EngineCommand'>,
    completion: {
      readonly assigneeAccountId: Id<'Account'> | null;
      readonly outcome: string | null;
    },
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).processTask.updateMany({
      where: { tenantId: tenant.tenantId, id: task.id, version: task.version, status: 'open' },
      data: {
        status: 'completing',
        completionKey,
        outcome: completion.outcome,
        ...(completion.assigneeAccountId === null
          ? {}
          : { assigneeAccountId: completion.assigneeAccountId }),
        version: { increment: 1 },
      },
    });
    return count === 1;
  }

  async assignTask(
    tenant: TenantContext,
    task: TaskRecord,
    assigneeAccountId: Id<'Account'> | null,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).processTask.updateMany({
      where: { tenantId: tenant.tenantId, id: task.id, version: task.version, status: 'open' },
      data: { assigneeAccountId, version: { increment: 1 } },
    });
    return count === 1;
  }

  async escalateTask(
    tenant: TenantContext,
    task: TaskRecord,
    at: Temporal.Instant,
  ): Promise<boolean> {
    if (task.escalationRoleId === null) return false;
    const { count } = await this.prisma.tx(tenant).processTask.updateMany({
      where: {
        tenantId: tenant.tenantId,
        id: task.id,
        version: task.version,
        status: { in: [...OPEN_TASK_STATUSES] },
        escalatedAt: null,
      },
      data: {
        status: 'open',
        completionKey: null,
        candidateRoleId: task.escalationRoleId,
        assigneeAccountId: null,
        escalatedAt: dateOf(at),
        version: { increment: 1 },
      },
    });
    return count === 1;
  }

  async inboxCandidates(
    tenant: TenantContext,
    accountId: Id<'Account'>,
    roleIds: readonly Id<'Role'>[],
    sites: TaskSites,
    limit: number,
  ): Promise<TaskRecord[]> {
    if (sites !== 'all' && sites.length === 0) return [];
    const rows = await this.prisma.tx(tenant).processTask.findMany({
      where: {
        tenantId: tenant.tenantId,
        ...siteFilterOf(sites),
        OR: [
          { assigneeAccountId: accountId, status: { in: [...OPEN_TASK_STATUSES] } },
          ...(roleIds.length === 0
            ? []
            : [{ assigneeAccountId: null, status: 'open', candidateRoleId: { in: [...roleIds] } }]),
        ],
      },
      orderBy: [...INBOX_ORDER],
      take: limit,
      select: TASK_COLUMNS,
    });
    return rows.map(taskOf);
  }

  async openTasksByDue(
    tenant: TenantContext,
    sites: TaskSites,
    limit: number,
  ): Promise<TaskRecord[]> {
    if (sites !== 'all' && sites.length === 0) return [];
    const rows = await this.prisma.tx(tenant).processTask.findMany({
      where: {
        tenantId: tenant.tenantId,
        ...siteFilterOf(sites),
        status: { in: [...OPEN_TASK_STATUSES] },
      },
      orderBy: [...INBOX_ORDER],
      take: limit,
      select: TASK_COLUMNS,
    });
    return rows.map(taskOf);
  }

  async tasksToEscalate(
    tenant: TenantContext,
    now: Temporal.Instant,
    limit: number,
  ): Promise<TaskRecord[]> {
    const rows = await this.prisma.tx(tenant).processTask.findMany({
      where: {
        tenantId: tenant.tenantId,
        status: 'open',
        escalationRoleId: { not: null },
        escalatedAt: null,
        dueAt: { lte: dateOf(now) },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: TASK_COLUMNS,
    });
    return rows.map(taskOf);
  }

  async closeTask(
    tenant: TenantContext,
    task: TaskRecord,
    status: TaskStatus,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).processTask.updateMany({
      where: { tenantId: tenant.tenantId, id: task.id, version: task.version },
      data: { status, closedAt: dateOf(at), version: { increment: 1 } },
    });
    return count === 1;
  }

  async insertCommand(
    tenant: TenantContext,
    command: NewCommand,
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).engineCommand.create({
      data: {
        tenantId: tenant.tenantId,
        id: command.id,
        kind: command.kind,
        subjectId: command.subjectId,
        payload: command.payload,
        correlationId: command.correlationId,
        attempts: 0,
        notBefore: dateOf(at),
        createdAt: dateOf(at),
      },
    });
  }

  async dueCommands(
    tenant: TenantContext,
    now: Temporal.Instant,
    limit: number,
  ): Promise<CommandRecord[]> {
    const rows = await this.prisma.tx(tenant).engineCommand.findMany({
      where: {
        tenantId: tenant.tenantId,
        publishedAt: null,
        deadAt: null,
        notBefore: { lte: dateOf(now) },
      },
      orderBy: [{ notBefore: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        kind: true,
        subjectId: true,
        payload: true,
        correlationId: true,
        attempts: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      id: row.id as Id<'EngineCommand'>,
      kind: row.kind as CommandKind,
      payload: row.payload as JsonObject,
    }));
  }

  async claimCommand(
    tenant: TenantContext,
    command: CommandRecord,
    leaseUntil: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).engineCommand.updateMany({
      where: {
        tenantId: tenant.tenantId,
        id: command.id,
        attempts: command.attempts,
        publishedAt: null,
        deadAt: null,
      },
      data: { attempts: command.attempts + 1, notBefore: dateOf(leaseUntil) },
    });
    return count === 1;
  }

  async ackCommand(tenant: TenantContext, id: string, at: Temporal.Instant): Promise<void> {
    await this.prisma.tx(tenant).engineCommand.updateMany({
      where: { tenantId: tenant.tenantId, id, publishedAt: null, deadAt: null },
      data: { publishedAt: dateOf(at), lastError: null },
    });
  }

  async releaseCommand(
    tenant: TenantContext,
    command: CommandRecord,
    retryAt: Temporal.Instant,
    error: string,
  ): Promise<void> {
    // Only this claim's row: a relay that claimed it again after the lease keeps its lease.
    await this.prisma.tx(tenant).engineCommand.updateMany({
      where: {
        tenantId: tenant.tenantId,
        id: command.id,
        attempts: command.attempts,
        publishedAt: null,
        deadAt: null,
      },
      data: { notBefore: dateOf(retryAt), lastError: error },
    });
  }

  async killCommand(
    tenant: TenantContext,
    id: string,
    at: Temporal.Instant,
    error: string,
  ): Promise<void> {
    await this.prisma.tx(tenant).engineCommand.updateMany({
      where: { tenantId: tenant.tenantId, id, publishedAt: null, deadAt: null },
      data: { deadAt: dateOf(at), lastError: error },
    });
  }

  async recordObservation(
    tenant: TenantContext,
    eventId: string,
    handler: string,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).engineObservation.createMany({
      data: [{ tenantId: tenant.tenantId, eventId, handler, observedAt: dateOf(at) }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async readSyncState(tenant: TenantContext): Promise<SyncState> {
    const row = await this.prisma.tx(tenant).engineSyncState.findUnique({
      where: { tenantId: tenant.tenantId },
      select: { tasksEndedAfter: true, instancesEndedAfter: true, version: true },
    });
    if (row === null) return { tasksEndedAfter: null, instancesEndedAfter: null, version: 0 };
    return {
      tasksEndedAfter: row.tasksEndedAfter === null ? null : instantOf(row.tasksEndedAfter),
      instancesEndedAfter:
        row.instancesEndedAfter === null ? null : instantOf(row.instancesEndedAfter),
      version: row.version,
    };
  }

  async saveSyncState(
    tenant: TenantContext,
    state: Omit<SyncState, 'version'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const data = {
      tasksEndedAfter: state.tasksEndedAfter === null ? null : dateOf(state.tasksEndedAfter),
      instancesEndedAfter:
        state.instancesEndedAfter === null ? null : dateOf(state.instancesEndedAfter),
      updatedAt: dateOf(at),
    };
    const tx = this.prisma.tx(tenant);
    if (expectedVersion === 0) {
      const { count } = await tx.engineSyncState.createMany({
        data: [{ tenantId: tenant.tenantId, ...data, version: 1 }],
        skipDuplicates: true,
      });
      return count === 1;
    }
    const { count } = await tx.engineSyncState.updateMany({
      where: { tenantId: tenant.tenantId, version: expectedVersion },
      data: { ...data, version: expectedVersion + 1 },
    });
    return count === 1;
  }

  async readWorkingCalendar(tenant: TenantContext): Promise<CalendarRecord> {
    const row = await this.prisma.tx(tenant).workingCalendar.findUnique({
      where: { tenantId: tenant.tenantId },
      select: { weekendDays: true, holidays: true, version: true },
    });
    return row === null
      ? { weekendDays: [], holidays: [], version: 0 }
      : {
          weekendDays: row.weekendDays,
          holidays: row.holidays.map(isoOf).sort(),
          version: row.version,
        };
  }

  async saveWorkingCalendar(
    tenant: TenantContext,
    calendar: Omit<CalendarRecord, 'version'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const tx = this.prisma.tx(tenant);
    const values = {
      weekendDays: [...calendar.weekendDays],
      holidays: calendar.holidays.map(dayOf),
      updatedAt: dateOf(at),
    };
    if (expectedVersion === 0) {
      const { count } = await tx.workingCalendar.createMany({
        data: [{ tenantId: tenant.tenantId, ...values, version: 1 }],
        skipDuplicates: true,
      });
      return count === 1;
    }
    const { count } = await tx.workingCalendar.updateMany({
      where: { tenantId: tenant.tenantId, version: expectedVersion },
      data: { ...values, version: { increment: 1 } },
    });
    return count === 1;
  }

  async recordIncident(tenant: TenantContext, incident: IncidentRecord): Promise<void> {
    await this.prisma.tx(tenant).processIncident.createMany({
      data: [
        {
          tenantId: tenant.tenantId,
          id: incident.id,
          kind: incident.kind,
          engineRef: incident.engineRef,
          instanceId: incident.instanceId,
          detectedAt: dateOf(incident.detectedAt),
        },
      ],
      skipDuplicates: true,
    });
  }

  async latestIncidents(tenant: TenantContext, limit: number): Promise<IncidentRecord[]> {
    const rows = await this.prisma.tx(tenant).processIncident.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, kind: true, engineRef: true, instanceId: true, detectedAt: true },
    });
    return rows.map((row) => ({
      id: row.id as Id<'ProcessIncident'>,
      kind: row.kind as IncidentKind,
      engineRef: row.engineRef,
      instanceId: row.instanceId as Id<'ProcessInstance'> | null,
      detectedAt: instantOf(row.detectedAt),
    }));
  }
}

function taskOf(row: {
  id: string;
  instanceId: string;
  engineTaskId: string;
  taskKey: string;
  formKey: string | null;
  formRevisionId: string | null;
  status: string;
  completionKey: string | null;
  version: number;
  siteId: string | null;
  name: string | null;
  candidateRoleId: string | null;
  assigneeAccountId: string | null;
  dueAt: Date | null;
  escalationRoleId: string | null;
  escalatedAt: Date | null;
  outcomes: string[];
  outcome: string | null;
  openedAt: Date;
}): TaskRecord {
  return {
    ...row,
    id: row.id as Id<'ProcessTask'>,
    instanceId: row.instanceId as Id<'ProcessInstance'>,
    formRevisionId: row.formRevisionId as Id<'FormRevision'> | null,
    status: row.status as TaskStatus,
    siteId: row.siteId as Id<'Site'> | null,
    candidateRoleId: row.candidateRoleId as Id<'Role'> | null,
    assigneeAccountId: row.assigneeAccountId as Id<'Account'> | null,
    dueAt: row.dueAt === null ? null : instantOf(row.dueAt),
    escalationRoleId: row.escalationRoleId as Id<'Role'> | null,
    escalatedAt: row.escalatedAt === null ? null : instantOf(row.escalatedAt),
    openedAt: instantOf(row.openedAt),
  };
}
