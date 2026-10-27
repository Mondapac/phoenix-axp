import { Temporal } from '@phoenix/shared-kernel';
import type { Id, TenantContext } from '@phoenix/shared-kernel';
import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../platform/persistence/prisma.service';
import type {
  ClaimedCommand,
  FormRevisionRecord,
  IncidentRecord,
  OutboxRecord,
  ProcessRevisionRecord,
  ProcessStore,
  RequestRecord,
  TaskPatch,
  TaskRecord,
} from '../application/ports/process-store';
import type { RequestStatus } from '../domain/request';
import type { Decision, TaskStatus } from '../domain/task';

const toDate = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const toInstant = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());
/** A JSON value the caller already validated (a schema, the answers, a payload). */
const json = (value: object) => value as Prisma.InputJsonValue;

type TaskRow = {
  id: string;
  requestId: string;
  engineTaskId: string;
  taskKey: string;
  formKey: string;
  assigneeId: string;
  status: string;
  decision: string | null;
  completionKey: string | null;
  openedAt: Date;
  closedAt: Date | null;
  version: number;
};
type RequestRow = {
  id: string;
  requesterId: string;
  formRevisionId: string;
  processRevisionId: string;
  answers: Prisma.JsonValue;
  contentHash: string;
  status: string;
  processInstanceId: string | null;
  submittedAt: Date;
  version: number;
};

const taskOf = (row: TaskRow): TaskRecord => ({
  id: row.id as Id<'Task'>,
  requestId: row.requestId,
  engineTaskId: row.engineTaskId,
  taskKey: row.taskKey,
  formKey: row.formKey,
  assigneeId: row.assigneeId,
  status: row.status as TaskStatus,
  decision: row.decision as Decision | null,
  completionKey: row.completionKey,
  openedAt: toInstant(row.openedAt),
  closedAt: row.closedAt === null ? null : toInstant(row.closedAt),
  version: row.version,
});

const requestOf = (row: RequestRow): RequestRecord => ({
  id: row.id as Id<'Request'>,
  requesterId: row.requesterId,
  formRevisionId: row.formRevisionId,
  processRevisionId: row.processRevisionId,
  answers: row.answers as object,
  contentHash: row.contentHash,
  status: row.status as RequestStatus,
  processInstanceId: row.processInstanceId,
  submittedAt: toInstant(row.submittedAt),
  version: row.version,
});

/**
 * {@link ProcessStore} on the open unit's guarded view (`PrismaService.tx`): every query passes
 * the tenant guard and, in PostgreSQL, row-level security. Compare-and-set writes use
 * `updateMany` with the expected value in the `where`, so a concurrent writer makes the count
 * 0 instead of overwriting.
 */
export class PrismaProcessStore implements ProcessStore {
  constructor(private readonly prisma: PrismaService) {}

  async latestFormRevision(tenant: TenantContext, formKey: string) {
    const row = await this.prisma.tx(tenant).formRevision.findFirst({
      where: { tenantId: tenant.tenantId, formKey },
      orderBy: { revision: 'desc' },
    });
    return row === null
      ? null
      : {
          id: row.id as Id<'FormRevision'>,
          formKey: row.formKey,
          revision: row.revision,
          jsonSchema: row.jsonSchema as object,
          uiSchema: row.uiSchema as object,
          contentHash: row.contentHash,
          publishedAt: toInstant(row.publishedAt),
        };
  }

  async latestProcessRevision(tenant: TenantContext, processKey: string) {
    const row = await this.prisma.tx(tenant).processRevision.findFirst({
      where: { tenantId: tenant.tenantId, processKey },
      orderBy: { revision: 'desc' },
    });
    return row === null ? null : this.processRevisionOf(row);
  }

  async findProcessRevision(tenant: TenantContext, revisionId: string) {
    const row = await this.prisma.tx(tenant).processRevision.findFirst({
      where: { tenantId: tenant.tenantId, id: revisionId },
    });
    return row === null ? null : this.processRevisionOf(row);
  }

  async insertFormRevision(tenant: TenantContext, record: FormRevisionRecord): Promise<void> {
    await this.prisma.tx(tenant).formRevision.create({
      data: {
        ...record,
        tenantId: tenant.tenantId,
        jsonSchema: json(record.jsonSchema),
        uiSchema: json(record.uiSchema),
        publishedAt: toDate(record.publishedAt),
      },
    });
  }

  async insertProcessRevision(tenant: TenantContext, record: ProcessRevisionRecord): Promise<void> {
    await this.prisma.tx(tenant).processRevision.create({
      data: { ...record, tenantId: tenant.tenantId, publishedAt: toDate(record.publishedAt) },
    });
  }

  async insertRequest(tenant: TenantContext, record: RequestRecord): Promise<void> {
    await this.prisma.tx(tenant).request.create({
      data: {
        ...record,
        tenantId: tenant.tenantId,
        answers: json(record.answers),
        submittedAt: toDate(record.submittedAt),
      },
    });
  }

  async findRequest(tenant: TenantContext, requestId: string) {
    const row = await this.prisma.tx(tenant).request.findFirst({
      where: { tenantId: tenant.tenantId, id: requestId },
    });
    return row === null ? null : requestOf(row);
  }

  async runningRequests(tenant: TenantContext) {
    const rows = await this.prisma.tx(tenant).request.findMany({
      where: { tenantId: tenant.tenantId, status: 'running' },
      orderBy: { id: 'asc' },
    });
    return rows.map(requestOf);
  }

  async adoptInstance(tenant: TenantContext, requestId: string, instanceId: string) {
    const view = this.prisma.tx(tenant);
    await view.request.updateMany({
      where: { tenantId: tenant.tenantId, id: requestId, processInstanceId: null },
      data: { processInstanceId: instanceId, status: 'running', version: { increment: 1 } },
    });
    const row = await view.request.findFirst({
      where: { tenantId: tenant.tenantId, id: requestId },
      select: { processInstanceId: true },
    });
    return row?.processInstanceId ?? null;
  }

  async closeRequest(tenant: TenantContext, requestId: string, status: RequestStatus) {
    const { count } = await this.prisma.tx(tenant).request.updateMany({
      where: { tenantId: tenant.tenantId, id: requestId, status: 'running' },
      data: { status, version: { increment: 1 } },
    });
    return count === 1;
  }

  async insertTask(tenant: TenantContext, record: TaskRecord) {
    const { count } = await this.prisma.tx(tenant).task.createMany({
      data: [
        {
          ...record,
          tenantId: tenant.tenantId,
          openedAt: toDate(record.openedAt),
          closedAt: record.closedAt === null ? null : toDate(record.closedAt),
        },
      ],
      skipDuplicates: true,
    });
    return count === 1 ? ('inserted' as const) : ('exists' as const);
  }

  async findTask(tenant: TenantContext, taskId: string) {
    const row = await this.prisma.tx(tenant).task.findFirst({
      where: { tenantId: tenant.tenantId, id: taskId },
    });
    return row === null ? null : taskOf(row);
  }

  async tasks(
    tenant: TenantContext,
    filter: {
      readonly statuses?: readonly TaskStatus[];
      readonly assigneeId?: string;
      readonly requestId?: string;
    },
  ) {
    const rows = await this.prisma.tx(tenant).task.findMany({
      where: {
        tenantId: tenant.tenantId,
        ...(filter.statuses === undefined ? {} : { status: { in: [...filter.statuses] } }),
        ...(filter.assigneeId === undefined ? {} : { assigneeId: filter.assigneeId }),
        ...(filter.requestId === undefined ? {} : { requestId: filter.requestId }),
      },
      orderBy: { id: 'asc' },
    });
    return rows.map(taskOf);
  }

  async updateTask(
    tenant: TenantContext,
    taskId: string,
    expectedVersion: number,
    patch: TaskPatch,
  ) {
    const { closedAt, ...rest } = patch;
    const { count } = await this.prisma.tx(tenant).task.updateMany({
      where: { tenantId: tenant.tenantId, id: taskId, version: expectedVersion },
      data: {
        ...rest,
        ...(closedAt === undefined
          ? {}
          : { closedAt: closedAt === null ? null : toDate(closedAt) }),
        version: { increment: 1 },
      },
    });
    return count === 1;
  }

  async appendOutbox(tenant: TenantContext, row: OutboxRecord): Promise<void> {
    await this.prisma.tx(tenant).outbox.create({
      data: {
        ...row,
        tenantId: tenant.tenantId,
        occurredAt: toDate(row.occurredAt),
        payload: json(row.payload),
        attempts: 0,
        leaseUntil: null,
        lastError: null,
        publishedAt: null,
      },
    });
  }

  async claimOutbox(
    tenant: TenantContext,
    now: Temporal.Instant,
    leaseUntil: Temporal.Instant,
    limit: number,
  ): Promise<ClaimedCommand[]> {
    const view = this.prisma.tx(tenant);
    const due = await view.outbox.findMany({
      where: {
        tenantId: tenant.tenantId,
        publishedAt: null,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: toDate(now) } }],
      },
      orderBy: { eventId: 'asc' },
      take: limit,
    });
    const claimed: ClaimedCommand[] = [];
    for (const row of due) {
      // Compare-and-set on attempts: of two relays that read the same row, one wins.
      const { count } = await view.outbox.updateMany({
        where: {
          tenantId: tenant.tenantId,
          eventId: row.eventId,
          attempts: row.attempts,
          publishedAt: null,
        },
        data: { attempts: row.attempts + 1, leaseUntil: toDate(leaseUntil) },
      });
      if (count === 1) {
        claimed.push({
          eventId: row.eventId,
          type: row.type,
          payload: row.payload as Readonly<Record<string, unknown>>,
          attempts: row.attempts + 1,
        });
      }
    }
    return claimed;
  }

  async ackOutbox(tenant: TenantContext, claim: ClaimedCommand, now: Temporal.Instant) {
    const { count } = await this.prisma.tx(tenant).outbox.updateMany({
      where: { tenantId: tenant.tenantId, eventId: claim.eventId, publishedAt: null },
      data: { publishedAt: toDate(now), leaseUntil: null, lastError: null },
    });
    return count === 1;
  }

  async releaseOutbox(
    tenant: TenantContext,
    claim: ClaimedCommand,
    retryAt: Temporal.Instant,
    errorCode: string,
  ): Promise<void> {
    await this.prisma.tx(tenant).outbox.updateMany({
      where: {
        tenantId: tenant.tenantId,
        eventId: claim.eventId,
        attempts: claim.attempts,
        publishedAt: null,
      },
      data: { leaseUntil: toDate(retryAt), lastError: errorCode },
    });
  }

  async recordInInbox(
    tenant: TenantContext,
    eventId: string,
    handler: string,
    now: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).inbox.createMany({
      data: [{ tenantId: tenant.tenantId, eventId, handler, processedAt: toDate(now) }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async recordIncident(tenant: TenantContext, incident: IncidentRecord): Promise<void> {
    await this.prisma.tx(tenant).incident.create({
      data: { ...incident, tenantId: tenant.tenantId, detectedAt: toDate(incident.detectedAt) },
    });
  }

  private processRevisionOf(row: {
    id: string;
    processKey: string;
    revision: number;
    bpmnXml: string;
    contentHash: string;
    publishedAt: Date;
  }): ProcessRevisionRecord {
    return {
      id: row.id as Id<'ProcessRevision'>,
      processKey: row.processKey,
      revision: row.revision,
      bpmnXml: row.bpmnXml,
      contentHash: row.contentHash,
      publishedAt: toInstant(row.publishedAt),
    };
  }
}
