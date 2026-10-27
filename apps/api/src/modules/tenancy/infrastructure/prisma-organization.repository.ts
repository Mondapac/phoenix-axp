import { Injectable } from '@nestjs/common';
import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  OrganizationRecord,
  OrganizationRepository,
} from '../application/organization.repository';
import type { Subtree } from '../application/site.repository';
import { insertNode, moveSubtree, subtreeOf } from './closure-table';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const COLUMNS = { id: true, parentId: true, name: true, depth: true, version: true } as const;

/** The organization chart in `tenancy.organization` and `tenancy.organization_ancestry`. */
@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(tenant: TenantContext, id: Id<'Organization'>): Promise<OrganizationRecord | null> {
    const row = await this.prisma.tx(tenant).organization.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: COLUMNS,
    });
    return row === null ? null : organizationOf(row);
  }

  async list(tenant: TenantContext): Promise<OrganizationRecord[]> {
    const rows = await this.prisma.tx(tenant).organization.findMany({
      where: { tenantId: tenant.tenantId },
      select: COLUMNS,
      orderBy: [{ depth: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(organizationOf);
  }

  async insert(
    tenant: TenantContext,
    organization: Omit<OrganizationRecord, 'version'>,
    at: Temporal.Instant,
  ): Promise<void> {
    const tx = this.prisma.tx(tenant);
    await tx.organization.create({
      data: {
        tenantId: tenant.tenantId,
        id: organization.id,
        parentId: organization.parentId,
        name: organization.name,
        depth: organization.depth,
        version: 1,
        createdAt: dateOf(at),
        updatedAt: dateOf(at),
      },
    });
    await insertNode(tx.organizationAncestry, tenant, organization.id, organization.parentId);
  }

  async rename(
    tenant: TenantContext,
    id: Id<'Organization'>,
    expectedVersion: number,
    name: string,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).organization.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: { name, version: { increment: 1 }, updatedAt: dateOf(at) },
    });
    if (count === 0) throw new StaleAggregateError('tenancy.organization', id);
  }

  subtree(tenant: TenantContext, id: Id<'Organization'>): Promise<Subtree<'Organization'>> {
    return subtreeOf(this.prisma.tx(tenant).organizationAncestry, tenant, id);
  }

  async move(
    tenant: TenantContext,
    subtree: Subtree<'Organization'>,
    newParentId: Id<'Organization'> | null,
    depthShift: number,
    at: Temporal.Instant,
  ): Promise<void> {
    const tx = this.prisma.tx(tenant);
    const [rootId, ...below] = subtree.ids;
    // The parent and the depth change in one statement: the depth CHECK ties a null parent to
    // depth 0.
    await tx.organization.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: rootId! }, tenantId: tenant.tenantId },
      data: { parentId: newParentId, depth: { increment: depthShift }, updatedAt: dateOf(at) },
    });
    if (depthShift !== 0 && below.length > 0) {
      await tx.organization.updateMany({
        where: { tenantId: tenant.tenantId, id: { in: below } },
        data: { depth: { increment: depthShift } },
      });
    }
    await moveSubtree(tx.organizationAncestry, tenant, subtree, newParentId);
  }
}

function organizationOf(row: {
  id: string;
  parentId: string | null;
  name: string;
  depth: number;
  version: number;
}): OrganizationRecord {
  return {
    id: row.id as Id<'Organization'>,
    parentId: row.parentId as Id<'Organization'> | null,
    name: row.name,
    depth: row.depth,
    version: row.version,
  };
}
