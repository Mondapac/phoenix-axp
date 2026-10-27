import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { ContentHash, Id, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  FormChanges,
  FormFilter,
  FormRecord,
  FormRepository,
  FormRevisionRecord,
  FormRevisionSummary,
} from '../application/form.repository';
import { retentionDaysOf, retentionOf, type Audience } from '../domain/form-settings';
import type { JsonObject } from '../domain/form-schema';
import type { FormStatus } from '../domain/lifecycle';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

const FORM_COLUMNS = {
  id: true,
  siteId: true,
  key: true,
  name: true,
  status: true,
  publishedRevisionId: true,
  audience: true,
  roleIds: true,
  allowOnBehalf: true,
  retentionDays: true,
  revisionCount: true,
  version: true,
} as const;

const SUMMARY_COLUMNS = {
  id: true,
  formId: true,
  number: true,
  contentHash: true,
  createdAt: true,
} as const;

/** The forms in `forms.form` and their revisions in `forms.form_revision`, through `tx(tenant)`. */
@Injectable()
export class PrismaFormRepository implements FormRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(tenant: TenantContext, id: Id<'Form'>): Promise<FormRecord | null> {
    const row = await this.prisma.tx(tenant).form.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: FORM_COLUMNS,
    });
    return row === null ? null : formOf(row);
  }

  async list(tenant: TenantContext, filter: FormFilter): Promise<FormRecord[]> {
    const rows = await this.prisma.tx(tenant).form.findMany({
      where: {
        tenantId: tenant.tenantId,
        ...(filter.siteId === null ? {} : { siteId: filter.siteId }),
        ...(filter.status === null ? {} : { status: filter.status }),
      },
      select: FORM_COLUMNS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(formOf);
  }

  async insert(
    tenant: TenantContext,
    form: Omit<FormRecord, 'status' | 'publishedRevisionId' | 'latestRevisionNumber' | 'version'>,
    at: Temporal.Instant,
  ): Promise<'created' | 'key-taken'> {
    try {
      await this.prisma.tx(tenant).form.create({
        data: {
          tenantId: tenant.tenantId,
          id: form.id,
          siteId: form.siteId,
          key: form.key,
          name: form.name,
          status: 'draft',
          audience: form.policy.audience,
          roleIds: [...form.policy.roleIds],
          allowOnBehalf: form.policy.allowOnBehalf,
          retentionDays: retentionDaysOf(form.retention),
          revisionCount: 0,
          version: 1,
          createdAt: dateOf(at),
          updatedAt: dateOf(at),
        },
      });
      return 'created';
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'form_tenant_id_key_key') return 'key-taken';
      throw error;
    }
  }

  async saveState(
    tenant: TenantContext,
    id: Id<'Form'>,
    expectedVersion: number,
    changes: FormChanges,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).form.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.policy === undefined
          ? {}
          : {
              audience: changes.policy.audience,
              roleIds: [...changes.policy.roleIds],
              allowOnBehalf: changes.policy.allowOnBehalf,
            }),
        ...(changes.retention === undefined
          ? {}
          : { retentionDays: retentionDaysOf(changes.retention) }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.publishedRevisionId === undefined
          ? {}
          : { publishedRevisionId: changes.publishedRevisionId }),
        version: { increment: 1 },
        updatedAt: dateOf(at),
      },
    });
    if (count === 0) throw new StaleAggregateError('forms.form', id);
  }

  async appendRevision(
    tenant: TenantContext,
    revision: Omit<FormRevisionRecord, 'number'>,
  ): Promise<{ readonly number: number } | null> {
    const tx = this.prisma.tx(tenant);
    // One statement takes the row lock and the number: a concurrent save waits here, then
    // takes the next one. The form's version is untouched (its own fields did not change).
    const { count } = await tx.form.updateMany({
      where: { tenantId: tenant.tenantId, id: revision.formId },
      data: { revisionCount: { increment: 1 } },
    });
    if (count === 0) return null;
    const form = await tx.form.findUnique({
      where: {
        tenantId_id: { tenantId: tenant.tenantId, id: revision.formId },
        tenantId: tenant.tenantId,
      },
      select: { revisionCount: true },
    });
    const number = form!.revisionCount;
    await tx.formRevision.create({
      data: {
        tenantId: tenant.tenantId,
        id: revision.id,
        formId: revision.formId,
        number,
        jsonSchema: revision.jsonSchema as object,
        uiSchema: revision.uiSchema as object,
        contentHash: revision.contentHash,
        createdAt: dateOf(revision.createdAt),
      },
    });
    return { number };
  }

  async findRevision(
    tenant: TenantContext,
    id: Id<'FormRevision'>,
  ): Promise<FormRevisionRecord | null> {
    const row = await this.prisma.tx(tenant).formRevision.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: { ...SUMMARY_COLUMNS, jsonSchema: true, uiSchema: true },
    });
    if (row === null) return null;
    return {
      ...summaryOf(row),
      jsonSchema: row.jsonSchema as JsonObject,
      uiSchema: row.uiSchema as JsonObject,
    };
  }

  async listRevisions(tenant: TenantContext, formId: Id<'Form'>): Promise<FormRevisionSummary[]> {
    const rows = await this.prisma.tx(tenant).formRevision.findMany({
      where: { tenantId: tenant.tenantId, formId },
      select: SUMMARY_COLUMNS,
      orderBy: { number: 'desc' },
    });
    return rows.map(summaryOf);
  }
}

function formOf(row: {
  id: string;
  siteId: string;
  key: string;
  name: string;
  status: string;
  publishedRevisionId: string | null;
  audience: string;
  roleIds: string[];
  allowOnBehalf: boolean;
  retentionDays: number | null;
  revisionCount: number;
  version: number;
}): FormRecord {
  return {
    id: row.id as Id<'Form'>,
    siteId: row.siteId as Id<'Site'>,
    key: row.key,
    name: row.name,
    // The CHECKs keep both columns inside their closed sets.
    status: row.status as FormStatus,
    publishedRevisionId: row.publishedRevisionId as Id<'FormRevision'> | null,
    policy: {
      audience: row.audience as Audience,
      roleIds: row.roleIds as Id<'Role'>[],
      allowOnBehalf: row.allowOnBehalf,
    },
    retention: retentionOf(row.retentionDays),
    latestRevisionNumber: row.revisionCount,
    version: row.version,
  };
}

function summaryOf(row: {
  id: string;
  formId: string;
  number: number;
  contentHash: string;
  createdAt: Date;
}): FormRevisionSummary {
  return {
    id: row.id as Id<'FormRevision'>,
    formId: row.formId as Id<'Form'>,
    number: row.number,
    contentHash: row.contentHash as ContentHash,
    createdAt: instantOf(row.createdAt),
  };
}
