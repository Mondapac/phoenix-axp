import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { Id, JsonObject, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  CommandRecord,
  IncidentRecord,
  InstanceRecord,
  NewCommand,
  ProcessRepository,
  RevisionRecord,
  SyncState,
  TaskRecord,
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
  status: true,
  completionKey: true,
  version: true,
} as const;

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
    revision: RevisionRecord & { readonly contentHash: string },
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

  async insertInstance(
    tenant: TenantContext,
    instance: { readonly id: Id<'ProcessInstance'>; readonly revisionId: Id<'ProcessRevision'> },
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).processInstance.create({
      data: {
        tenantId: tenant.tenantId,
        id: instance.id,
        revisionId: instance.revisionId,
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
      select: { id: true, revisionId: true, status: true, engineInstanceId: true, version: true },
    });
    return row === null
      ? null
      : {
          ...row,
          id: row.id as Id<'ProcessInstance'>,
          revisionId: row.revisionId as Id<'ProcessRevision'>,
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

  async insertTask(
    tenant: TenantContext,
    task: Omit<TaskRecord, 'version' | 'completionKey'>,
    at: Temporal.Instant,
  ): Promise<void> {
    const open = OPEN_TASK_STATUSES.includes(task.status);
    await this.prisma.tx(tenant).processTask.create({
      data: {
        tenantId: tenant.tenantId,
        id: task.id,
        instanceId: task.instanceId,
        engineTaskId: task.engineTaskId,
        taskKey: task.taskKey,
        formKey: task.formKey,
        status: task.status,
        completionKey: null,
        openedAt: dateOf(at),
        closedAt: open ? null : dateOf(at),
        version: 1,
      },
    });
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
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).processTask.updateMany({
      where: { tenantId: tenant.tenantId, id: task.id, version: task.version, status: 'open' },
      data: { status: 'completing', completionKey, version: { increment: 1 } },
    });
    return count === 1;
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
  status: string;
  completionKey: string | null;
  version: number;
}): TaskRecord {
  return {
    ...row,
    id: row.id as Id<'ProcessTask'>,
    instanceId: row.instanceId as Id<'ProcessInstance'>,
    status: row.status as TaskStatus,
  };
}
