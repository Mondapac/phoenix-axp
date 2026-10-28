import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { ContentHash, Id, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  DefinitionChanges,
  DefinitionFilter,
  DefinitionRecord,
  DefinitionRepository,
  RevisionRecord,
  RevisionSummary,
} from '../application/definition.repository';
import { fieldsOf } from '../domain/fields';
import type { DefinitionStatus } from '../domain/lifecycle';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

const DEFINITION_COLUMNS = {
  id: true,
  siteId: true,
  key: true,
  name: true,
  status: true,
  publishedRevisionId: true,
  revisionCount: true,
  version: true,
} as const;

const REVISION_COLUMNS = {
  id: true,
  definitionId: true,
  number: true,
  fields: true,
  contentHash: true,
  createdAt: true,
} as const;

/** The definitions in `objects.object_definition` and their revisions, through `tx(tenant)`. */
@Injectable()
export class PrismaDefinitionRepository implements DefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(tenant: TenantContext, id: Id<'ObjectDefinition'>): Promise<DefinitionRecord | null> {
    const row = await this.prisma.tx(tenant).objectDefinition.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: DEFINITION_COLUMNS,
    });
    return row === null ? null : definitionOf(row);
  }

  async findByKey(tenant: TenantContext, key: string): Promise<DefinitionRecord | null> {
    const row = await this.prisma.tx(tenant).objectDefinition.findUnique({
      where: { tenantId_key: { tenantId: tenant.tenantId, key }, tenantId: tenant.tenantId },
      select: DEFINITION_COLUMNS,
    });
    return row === null ? null : definitionOf(row);
  }

  async list(tenant: TenantContext, filter: DefinitionFilter): Promise<DefinitionRecord[]> {
    const rows = await this.prisma.tx(tenant).objectDefinition.findMany({
      where: {
        tenantId: tenant.tenantId,
        ...(filter.siteId === null ? {} : { siteId: filter.siteId }),
        ...(filter.status === null ? {} : { status: filter.status }),
      },
      select: DEFINITION_COLUMNS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(definitionOf);
  }

  async insert(
    tenant: TenantContext,
    definition: Pick<DefinitionRecord, 'id' | 'siteId' | 'key' | 'name'>,
    at: Temporal.Instant,
  ): Promise<'created' | 'key-taken'> {
    try {
      await this.prisma.tx(tenant).objectDefinition.create({
        data: {
          tenantId: tenant.tenantId,
          id: definition.id,
          siteId: definition.siteId,
          key: definition.key,
          name: definition.name,
          status: 'draft',
          revisionCount: 0,
          version: 1,
          createdAt: dateOf(at),
          updatedAt: dateOf(at),
        },
      });
      return 'created';
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'object_definition_tenant_id_key_key') {
        return 'key-taken';
      }
      throw error;
    }
  }

  async saveState(
    tenant: TenantContext,
    id: Id<'ObjectDefinition'>,
    expectedVersion: number,
    changes: DefinitionChanges,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).objectDefinition.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.publishedRevisionId === undefined
          ? {}
          : { publishedRevisionId: changes.publishedRevisionId }),
        version: { increment: 1 },
        updatedAt: dateOf(at),
      },
    });
    if (count === 0) throw new StaleAggregateError('objects.definition', id);
  }

  async takeRevisionNumber(
    tenant: TenantContext,
    id: Id<'ObjectDefinition'>,
  ): Promise<number | null> {
    const tx = this.prisma.tx(tenant);
    // One statement takes the row lock and the number; the version is untouched.
    const { count } = await tx.objectDefinition.updateMany({
      where: { tenantId: tenant.tenantId, id },
      data: { revisionCount: { increment: 1 } },
    });
    if (count === 0) return null;
    const row = await tx.objectDefinition.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: { revisionCount: true },
    });
    return row!.revisionCount;
  }

  async revisionByNumber(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    number: number,
  ): Promise<RevisionRecord | null> {
    const row = await this.prisma.tx(tenant).objectRevision.findUnique({
      where: {
        tenantId_definitionId_number: { tenantId: tenant.tenantId, definitionId, number },
        tenantId: tenant.tenantId,
      },
      select: REVISION_COLUMNS,
    });
    return row === null ? null : revisionOf(row);
  }

  async insertRevision(tenant: TenantContext, revision: RevisionRecord): Promise<void> {
    await this.prisma.tx(tenant).objectRevision.create({
      data: {
        tenantId: tenant.tenantId,
        id: revision.id,
        definitionId: revision.definitionId,
        number: revision.number,
        fields: revision.fields as unknown as object[],
        contentHash: revision.contentHash,
        createdAt: dateOf(revision.createdAt),
      },
    });
  }

  async findRevision(
    tenant: TenantContext,
    id: Id<'ObjectRevision'>,
  ): Promise<RevisionRecord | null> {
    const row = await this.prisma.tx(tenant).objectRevision.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: REVISION_COLUMNS,
    });
    return row === null ? null : revisionOf(row);
  }

  async revisions(
    tenant: TenantContext,
    ids: readonly Id<'ObjectRevision'>[],
  ): Promise<ReadonlyMap<string, RevisionRecord>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.tx(tenant).objectRevision.findMany({
      where: { tenantId: tenant.tenantId, id: { in: [...new Set(ids)] } },
      select: REVISION_COLUMNS,
    });
    return new Map(rows.map((row) => [row.id, revisionOf(row)]));
  }

  async listRevisions(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
  ): Promise<RevisionSummary[]> {
    const rows = await this.prisma.tx(tenant).objectRevision.findMany({
      where: { tenantId: tenant.tenantId, definitionId },
      select: { id: true, definitionId: true, number: true, contentHash: true, createdAt: true },
      orderBy: { number: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id as Id<'ObjectRevision'>,
      definitionId: row.definitionId as Id<'ObjectDefinition'>,
      number: row.number,
      contentHash: row.contentHash as ContentHash,
      createdAt: instantOf(row.createdAt),
    }));
  }
}

function definitionOf(row: {
  id: string;
  siteId: string;
  key: string;
  name: string;
  status: string;
  publishedRevisionId: string | null;
  revisionCount: number;
  version: number;
}): DefinitionRecord {
  return {
    id: row.id as Id<'ObjectDefinition'>,
    siteId: row.siteId as Id<'Site'>,
    key: row.key,
    name: row.name,
    status: row.status as DefinitionStatus,
    publishedRevisionId: row.publishedRevisionId as Id<'ObjectRevision'> | null,
    latestRevisionNumber: row.revisionCount,
    version: row.version,
  };
}

function revisionOf(row: {
  id: string;
  definitionId: string;
  number: number;
  fields: unknown;
  contentHash: string;
  createdAt: Date;
}): RevisionRecord {
  const fields = fieldsOf(row.fields);
  // A stored revision that does not read back is corrupt: never served as fields.
  if (fields === null) throw new Error(`objects: revision ${row.id} has unreadable fields`);
  return {
    id: row.id as Id<'ObjectRevision'>,
    definitionId: row.definitionId as Id<'ObjectDefinition'>,
    number: row.number,
    fields,
    contentHash: row.contentHash as ContentHash,
    createdAt: instantOf(row.createdAt),
  };
}
