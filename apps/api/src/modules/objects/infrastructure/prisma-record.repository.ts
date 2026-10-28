import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { ContentHash, Id, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  RecordPage,
  RecordRepository,
  RecordSplit,
  RecordWrite,
  StoredRecord,
} from '../application/record.repository';
import { valuesFromJson, valuesToJson } from '../domain/record-values';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

const RECORD_COLUMNS = {
  id: true,
  definitionId: true,
  revisionId: true,
  revisionHash: true,
  siteId: true,
  createdBy: true,
  values: true,
  sealed: true,
  sealedUnderId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The records in `objects.object_record`, through `tx(tenant)`. */
@Injectable()
export class PrismaRecordRepository implements RecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    id: Id<'ObjectRecord'>,
  ): Promise<StoredRecord | null> {
    const row = await this.prisma.tx(tenant).objectRecord.findFirst({
      where: { tenantId: tenant.tenantId, id, definitionId },
      select: RECORD_COLUMNS,
    });
    return row === null ? null : recordOf(row);
  }

  async list(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    page: RecordPage,
  ): Promise<StoredRecord[]> {
    if (page.sites !== 'all' && page.sites.length === 0) return [];
    const rows = await this.prisma.tx(tenant).objectRecord.findMany({
      where: {
        tenantId: tenant.tenantId,
        definitionId,
        ...(page.sites === 'all' ? {} : { siteId: { in: [...page.sites] } }),
        ...(page.before === null ? {} : { id: { lt: page.before } }),
      },
      select: RECORD_COLUMNS,
      orderBy: { id: 'desc' },
      take: page.limit,
    });
    return rows.map(recordOf);
  }

  async insert(
    tenant: TenantContext,
    record: Omit<StoredRecord, 'version' | 'createdAt' | 'updatedAt'>,
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).objectRecord.create({
      data: {
        tenantId: tenant.tenantId,
        id: record.id,
        definitionId: record.definitionId,
        revisionId: record.revisionId,
        revisionHash: record.revisionHash,
        siteId: record.siteId,
        createdBy: record.createdBy,
        values: valuesToJson(record.values),
        sealed: new Uint8Array(record.sealed),
        sealedUnderId: record.sealedUnderId,
        version: 1,
        createdAt: dateOf(at),
        updatedAt: dateOf(at),
      },
    });
  }

  async update(
    tenant: TenantContext,
    id: Id<'ObjectRecord'>,
    expectedVersion: number,
    write: RecordWrite,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).objectRecord.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: {
        revisionId: write.revisionId,
        revisionHash: write.revisionHash,
        values: valuesToJson(write.values),
        sealed: new Uint8Array(write.sealed),
        sealedUnderId: write.revisionId,
        version: { increment: 1 },
        updatedAt: dateOf(at),
      },
    });
    if (count === 0) throw new StaleAggregateError('objects.record', id);
  }

  async splitUnder(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    revisionIds: readonly Id<'ObjectRevision'>[],
    limit: number,
  ): Promise<StoredRecord[]> {
    if (revisionIds.length === 0) return [];
    const rows = await this.prisma.tx(tenant).objectRecord.findMany({
      where: { tenantId: tenant.tenantId, definitionId, sealedUnderId: { in: [...revisionIds] } },
      select: RECORD_COLUMNS,
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map(recordOf);
  }

  async resplit(
    tenant: TenantContext,
    record: Pick<StoredRecord, 'id' | 'version' | 'sealedUnderId'>,
    split: RecordSplit,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).objectRecord.updateMany({
      where: {
        tenantId: tenant.tenantId,
        id: record.id,
        version: record.version,
        sealedUnderId: record.sealedUnderId,
      },
      data: {
        values: valuesToJson(split.values),
        sealed: new Uint8Array(split.sealed),
        sealedUnderId: split.sealedUnderId,
      },
    });
    return count === 1;
  }

  async delete(
    tenant: TenantContext,
    id: Id<'ObjectRecord'>,
    expectedVersion: number,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).objectRecord.deleteMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
    });
    if (count === 0) throw new StaleAggregateError('objects.record', id);
  }
}

function recordOf(row: {
  id: string;
  definitionId: string;
  revisionId: string;
  revisionHash: string;
  siteId: string;
  createdBy: string;
  values: unknown;
  sealed: Uint8Array;
  sealedUnderId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): StoredRecord {
  return {
    id: row.id as Id<'ObjectRecord'>,
    definitionId: row.definitionId as Id<'ObjectDefinition'>,
    revisionId: row.revisionId as Id<'ObjectRevision'>,
    revisionHash: row.revisionHash as ContentHash,
    siteId: row.siteId as Id<'Site'>,
    createdBy: row.createdBy as Id<'Account'>,
    values: valuesFromJson(row.values),
    sealed: Buffer.from(row.sealed),
    sealedUnderId: row.sealedUnderId as Id<'ObjectRevision'>,
    version: row.version,
    createdAt: instantOf(row.createdAt),
    updatedAt: instantOf(row.updatedAt),
  };
}
