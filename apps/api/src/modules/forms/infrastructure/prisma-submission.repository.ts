import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { ContentHash, Id, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type {
  DueSubmission,
  InboxCursor,
  SubmissionRecord,
  SubmissionRepository,
  TrackedSubmission,
} from '../application/submission.repository';
import type { SubmissionChannel, SubmissionStatus } from '../domain/submission';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

const COLUMNS = {
  id: true,
  formId: true,
  revisionId: true,
  revisionHash: true,
  siteId: true,
  channel: true,
  submittedBy: true,
  status: true,
  data: true,
  submittedAt: true,
  eraseAfter: true,
  erasedAt: true,
  version: true,
} as const;

/** The submissions in `forms.form_submission`, through `tx(tenant)`. */
@Injectable()
export class PrismaSubmissionRepository implements SubmissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    tenant: TenantContext,
    submission: Omit<SubmissionRecord, 'status' | 'erasedAt' | 'version'> & {
      readonly trackingCodeHash: string;
    },
  ): Promise<'created' | 'tracking-code-taken'> {
    try {
      await this.prisma.tx(tenant).formSubmission.create({
        data: {
          tenantId: tenant.tenantId,
          id: submission.id,
          formId: submission.formId,
          revisionId: submission.revisionId,
          revisionHash: submission.revisionHash,
          siteId: submission.siteId,
          trackingCodeHash: submission.trackingCodeHash,
          channel: submission.channel,
          submittedBy: submission.submittedBy,
          status: 'received',
          data: Uint8Array.from(submission.data),
          submittedAt: dateOf(submission.submittedAt),
          eraseAfter: submission.eraseAfter === null ? null : dateOf(submission.eraseAfter),
          version: 1,
        },
      });
      return 'created';
    } catch (error) {
      if (
        this.prisma.violatedConstraint(error) === 'form_submission_tenant_id_tracking_code_hash_key'
      ) {
        return 'tracking-code-taken';
      }
      throw error;
    }
  }

  async find(tenant: TenantContext, id: Id<'FormSubmission'>): Promise<SubmissionRecord | null> {
    const row = await this.prisma.tx(tenant).formSubmission.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: COLUMNS,
    });
    return row === null ? null : recordOf(row);
  }

  async findByTrackingCode(
    tenant: TenantContext,
    codeHash: string,
  ): Promise<TrackedSubmission | null> {
    const row = await this.prisma.tx(tenant).formSubmission.findUnique({
      where: {
        tenantId_trackingCodeHash: { tenantId: tenant.tenantId, trackingCodeHash: codeHash },
        tenantId: tenant.tenantId,
      },
      select: { formId: true, status: true, submittedAt: true },
    });
    if (row === null) return null;
    return {
      formId: row.formId as Id<'Form'>,
      status: row.status as SubmissionStatus,
      submittedAt: instantOf(row.submittedAt),
    };
  }

  async listForForm(
    tenant: TenantContext,
    formId: Id<'Form'>,
    page: { readonly after: InboxCursor | null; readonly limit: number },
  ): Promise<SubmissionRecord[]> {
    const { after } = page;
    const rows = await this.prisma.tx(tenant).formSubmission.findMany({
      where: {
        tenantId: tenant.tenantId,
        formId,
        ...(after === null
          ? {}
          : {
              OR: [
                { submittedAt: { lt: dateOf(after.submittedAt) } },
                { submittedAt: dateOf(after.submittedAt), id: { lt: after.id } },
              ],
            }),
      },
      select: COLUMNS,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });
    return rows.map(recordOf);
  }

  async markErased(
    tenant: TenantContext,
    id: Id<'FormSubmission'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).formSubmission.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion, erasedAt: null },
      data: { erasedAt: dateOf(at), version: { increment: 1 } },
    });
    return count === 1;
  }

  async dueForErasure(
    tenant: TenantContext,
    now: Temporal.Instant,
    limit: number,
  ): Promise<DueSubmission[]> {
    const rows = await this.prisma.tx(tenant).formSubmission.findMany({
      where: { tenantId: tenant.tenantId, erasedAt: null, eraseAfter: { lte: dateOf(now) } },
      select: { id: true, formId: true, version: true },
      orderBy: [{ eraseAfter: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id as Id<'FormSubmission'>,
      formId: row.formId as Id<'Form'>,
      version: row.version,
    }));
  }
}

function recordOf(row: {
  id: string;
  formId: string;
  revisionId: string;
  revisionHash: string;
  siteId: string;
  channel: string;
  submittedBy: string | null;
  status: string;
  data: Uint8Array;
  submittedAt: Date;
  eraseAfter: Date | null;
  erasedAt: Date | null;
  version: number;
}): SubmissionRecord {
  return {
    id: row.id as Id<'FormSubmission'>,
    formId: row.formId as Id<'Form'>,
    revisionId: row.revisionId as Id<'FormRevision'>,
    revisionHash: row.revisionHash as ContentHash,
    siteId: row.siteId as Id<'Site'>,
    // The CHECKs keep both columns inside their closed sets.
    channel: row.channel as SubmissionChannel,
    submittedBy: row.submittedBy as Id<'Account'> | null,
    status: row.status as SubmissionStatus,
    data: row.data,
    submittedAt: instantOf(row.submittedAt),
    eraseAfter: row.eraseAfter === null ? null : instantOf(row.eraseAfter),
    erasedAt: row.erasedAt === null ? null : instantOf(row.erasedAt),
    version: row.version,
  };
}
