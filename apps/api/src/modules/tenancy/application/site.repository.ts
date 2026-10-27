import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';

/** A site as the use cases read it. */
export interface SiteRecord {
  readonly id: Id<'Site'>;
  readonly parentSiteId: Id<'Site'> | null;
  readonly organizationId: Id<'Organization'> | null;
  readonly slug: string;
  readonly name: string;
  readonly depth: number;
  readonly version: number;
}

export interface SiteDomainRecord {
  readonly id: Id<'SiteDomain'>;
  readonly siteId: Id<'Site'>;
  readonly hostname: string;
  readonly pathPrefix: string;
}

/** A node's subtree: its own id first, then every descendant, and its height. */
export interface Subtree<K extends string> {
  readonly ids: readonly Id<K>[];
  /** The deepest level below the node, relative to it (0 for a leaf). */
  readonly height: number;
}

/**
 * The site tree of one tenant (ADR-0018 decision 2): the `site` rows and their closure table.
 * Every method runs in the caller's open unit (`tx(tenant)`); the writes that change the tree's
 * structure are called only after `TenantSettingsRepository.lockStructure` in the same unit.
 */
export interface SiteRepository {
  find(tenant: TenantContext, id: Id<'Site'>): Promise<SiteRecord | null>;
  /** Every site of the tenant, or of the subtree of `rootSiteId` (itself included), by depth. */
  list(tenant: TenantContext, rootSiteId: Id<'Site'> | null): Promise<SiteRecord[]>;
  /** Inserts the site and its closure rows; `slug-taken` when the slug is in use. */
  insert(
    tenant: TenantContext,
    site: Omit<SiteRecord, 'version'>,
    at: Temporal.Instant,
  ): Promise<'created' | 'slug-taken'>;
  /** Saves the name and organization link; throws StaleAggregateError on another version. */
  update(
    tenant: TenantContext,
    id: Id<'Site'>,
    expectedVersion: number,
    changes: { readonly name: string; readonly organizationId: Id<'Organization'> | null },
    at: Temporal.Instant,
  ): Promise<void>;
  subtree(tenant: TenantContext, id: Id<'Site'>): Promise<Subtree<'Site'>>;
  /**
   * Re-parents the root of `subtree`, shifts the depth of every node of it and rewrites its
   * closure rows. The caller has checked the plan (tree.ts).
   */
  move(
    tenant: TenantContext,
    subtree: Subtree<'Site'>,
    newParentId: Id<'Site'> | null,
    depthShift: number,
    at: Temporal.Instant,
  ): Promise<void>;
  /** Strictly below: a site is not within its own subtree here. */
  isWithinSubtree(tenant: TenantContext, id: Id<'Site'>, rootId: Id<'Site'>): Promise<boolean>;
  /** The depth of the deepest site of the tenant, or -1 without sites. */
  deepest(tenant: TenantContext): Promise<number>;

  domainsOf(tenant: TenantContext, siteId: Id<'Site'>): Promise<SiteDomainRecord[]>;
  findDomain(tenant: TenantContext, id: Id<'SiteDomain'>): Promise<SiteDomainRecord | null>;
  /** `taken` when the host and path already serve a site of the tenant. */
  addDomain(
    tenant: TenantContext,
    domain: SiteDomainRecord,
    at: Temporal.Instant,
  ): Promise<'added' | 'taken'>;
  removeDomain(tenant: TenantContext, id: Id<'SiteDomain'>): Promise<void>;
}

export const SITE_REPOSITORY = Symbol('SITE_REPOSITORY');
