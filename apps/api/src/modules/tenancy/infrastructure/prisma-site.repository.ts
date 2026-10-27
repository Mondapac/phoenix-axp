import { Injectable } from '@nestjs/common';
import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  SiteDomainRecord,
  SiteRecord,
  SiteRepository,
  Subtree,
} from '../application/site.repository';
import { insertNode, isStrictlyBelow, moveSubtree, subtreeOf } from './closure-table';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const SITE_COLUMNS = {
  id: true,
  parentSiteId: true,
  organizationId: true,
  slug: true,
  name: true,
  depth: true,
  version: true,
} as const;

const DOMAIN_COLUMNS = { id: true, siteId: true, hostname: true, pathPrefix: true } as const;

/** The site tree in `tenancy.site` and `tenancy.site_ancestry`, through `tx(tenant)`. */
@Injectable()
export class PrismaSiteRepository implements SiteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(tenant: TenantContext, id: Id<'Site'>): Promise<SiteRecord | null> {
    const row = await this.prisma.tx(tenant).site.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: SITE_COLUMNS,
    });
    return row === null ? null : siteOf(row);
  }

  async list(tenant: TenantContext, rootSiteId: Id<'Site'> | null): Promise<SiteRecord[]> {
    const rows = await this.prisma.tx(tenant).site.findMany({
      where:
        rootSiteId === null
          ? { tenantId: tenant.tenantId }
          : {
              tenantId: tenant.tenantId,
              ancestors: { some: { tenantId: tenant.tenantId, ancestorId: rootSiteId } },
            },
      select: SITE_COLUMNS,
      orderBy: [{ depth: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(siteOf);
  }

  async insert(
    tenant: TenantContext,
    site: Omit<SiteRecord, 'version'>,
    at: Temporal.Instant,
  ): Promise<'created' | 'slug-taken'> {
    const tx = this.prisma.tx(tenant);
    try {
      await tx.site.create({
        data: {
          tenantId: tenant.tenantId,
          id: site.id,
          parentSiteId: site.parentSiteId,
          organizationId: site.organizationId,
          slug: site.slug,
          name: site.name,
          depth: site.depth,
          version: 1,
          createdAt: dateOf(at),
          updatedAt: dateOf(at),
        },
      });
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'site_tenant_id_slug_key') return 'slug-taken';
      throw error;
    }
    await insertNode(tx.siteAncestry, tenant, site.id, site.parentSiteId);
    return 'created';
  }

  async update(
    tenant: TenantContext,
    id: Id<'Site'>,
    expectedVersion: number,
    changes: { readonly name: string; readonly organizationId: Id<'Organization'> | null },
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).site.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: {
        name: changes.name,
        organizationId: changes.organizationId,
        version: { increment: 1 },
        updatedAt: dateOf(at),
      },
    });
    if (count === 0) throw new StaleAggregateError('tenancy.site', id);
  }

  subtree(tenant: TenantContext, id: Id<'Site'>): Promise<Subtree<'Site'>> {
    return subtreeOf(this.prisma.tx(tenant).siteAncestry, tenant, id);
  }

  async move(
    tenant: TenantContext,
    subtree: Subtree<'Site'>,
    newParentId: Id<'Site'> | null,
    depthShift: number,
    at: Temporal.Instant,
  ): Promise<void> {
    const tx = this.prisma.tx(tenant);
    const [rootId, ...below] = subtree.ids;
    // The parent and the depth change in one statement: the depth CHECK ties a null parent to
    // depth 0.
    await tx.site.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: rootId! }, tenantId: tenant.tenantId },
      data: { parentSiteId: newParentId, depth: { increment: depthShift }, updatedAt: dateOf(at) },
    });
    if (depthShift !== 0 && below.length > 0) {
      await tx.site.updateMany({
        where: { tenantId: tenant.tenantId, id: { in: below } },
        data: { depth: { increment: depthShift } },
      });
    }
    await moveSubtree(tx.siteAncestry, tenant, subtree, newParentId);
  }

  isWithinSubtree(tenant: TenantContext, id: Id<'Site'>, rootId: Id<'Site'>): Promise<boolean> {
    return isStrictlyBelow(this.prisma.tx(tenant).siteAncestry, tenant, id, rootId);
  }

  async deepest(tenant: TenantContext): Promise<number> {
    const { _max } = await this.prisma.tx(tenant).site.aggregate({
      where: { tenantId: tenant.tenantId },
      _max: { depth: true },
    });
    return _max.depth ?? -1;
  }

  async domainsOf(tenant: TenantContext, siteId: Id<'Site'>): Promise<SiteDomainRecord[]> {
    const rows = await this.prisma.tx(tenant).siteDomain.findMany({
      where: { tenantId: tenant.tenantId, siteId },
      select: DOMAIN_COLUMNS,
      orderBy: [{ hostname: 'asc' }, { pathPrefix: 'asc' }],
    });
    return rows.map(domainOf);
  }

  async findDomain(tenant: TenantContext, id: Id<'SiteDomain'>): Promise<SiteDomainRecord | null> {
    const row = await this.prisma.tx(tenant).siteDomain.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: DOMAIN_COLUMNS,
    });
    return row === null ? null : domainOf(row);
  }

  async addDomain(
    tenant: TenantContext,
    domain: SiteDomainRecord,
    at: Temporal.Instant,
  ): Promise<'added' | 'taken'> {
    try {
      await this.prisma.tx(tenant).siteDomain.create({
        data: { tenantId: tenant.tenantId, ...domain, createdAt: dateOf(at) },
      });
      return 'added';
    } catch (error) {
      if (
        this.prisma.violatedConstraint(error) === 'site_domain_tenant_id_hostname_path_prefix_key'
      ) {
        return 'taken';
      }
      throw error;
    }
  }

  async removeDomain(tenant: TenantContext, id: Id<'SiteDomain'>): Promise<void> {
    await this.prisma
      .tx(tenant)
      .siteDomain.deleteMany({ where: { tenantId: tenant.tenantId, id } });
  }
}

function siteOf(row: {
  id: string;
  parentSiteId: string | null;
  organizationId: string | null;
  slug: string;
  name: string;
  depth: number;
  version: number;
}): SiteRecord {
  return {
    id: row.id as Id<'Site'>,
    parentSiteId: row.parentSiteId as Id<'Site'> | null,
    organizationId: row.organizationId as Id<'Organization'> | null,
    slug: row.slug,
    name: row.name,
    depth: row.depth,
    version: row.version,
  };
}

function domainOf(row: {
  id: string;
  siteId: string;
  hostname: string;
  pathPrefix: string;
}): SiteDomainRecord {
  return {
    id: row.id as Id<'SiteDomain'>,
    siteId: row.siteId as Id<'Site'>,
    hostname: row.hostname,
    pathPrefix: row.pathPrefix,
  };
}
