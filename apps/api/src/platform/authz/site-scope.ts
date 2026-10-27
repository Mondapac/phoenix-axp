// Phoenix-specific (ADR-0018 decisions 2 and 6): the port that answers subtree questions and
// the two pure-plus-port helpers that the GrantPolicy callers and the identity module's checks
// use. No template file: Mondapac has no site tree.
import type { CallContext, Id } from '@phoenix/shared-kernel';
import type { GrantScope } from './roles/role-model';

/**
 * "Is site X within the subtree of site Y", in the caller's tenant (ADR-0018 decision 2: the
 * closure table `site_ancestry` of the tenancy module answers it, under row-level security).
 * Within means strictly below: a site is not within its own subtree here, because equality is
 * decided without asking (see {@link siteRelation}).
 *
 * The tenancy module implements it (Phase 1, after PoC 1). Until then `AuthzModule` binds the
 * fail-closed placeholder of `placeholders/fail-closed-site-ancestry-reader.ts`, which always
 * answers `false`: no grant reaches a descendant, so access stays at the granted site itself,
 * and no site exists to grant on.
 * Implementations read committed state in a read-only unit of their own and cache nothing.
 */
export interface SiteAncestryReader {
  /**
   * True when `siteId` is a site of the caller's tenant: a site grant names one (identity's
   * role grants, slice 1.6). Another tenant's site, or none, answers false.
   */
  siteExists(context: CallContext, siteId: Id<'Site'>): Promise<boolean>;
  isWithinSubtree(
    context: CallContext,
    siteId: Id<'Site'>,
    rootSiteId: Id<'Site'>,
  ): Promise<boolean>;
  /**
   * Every site of the subtree of `rootSiteId`, itself included (ADR-0025: a list filters by the
   * sites a grant covers). A site of another tenant, or none, answers an empty list.
   */
  sitesWithin(context: CallContext, rootSiteId: Id<'Site'>): Promise<Id<'Site'>[]>;
}

/** Nest token of the {@link SiteAncestryReader}. */
export const SITE_ANCESTRY_READER = Symbol('SITE_ANCESTRY_READER');

/** How a site stands to a grant's site: the same site, strictly below it, or anywhere else. */
export type SiteRelation = 'same' | 'descendant' | 'outside';

/**
 * Where `siteId` stands relative to `rootSiteId`. The same id is `same` without asking the
 * reader; otherwise the reader decides between `descendant` and `outside`. A reader that
 * throws makes this throw: a caller never turns an unanswered question into access.
 */
export async function siteRelation(
  reader: SiteAncestryReader,
  context: CallContext,
  siteId: Id<'Site'>,
  rootSiteId: Id<'Site'>,
): Promise<SiteRelation> {
  if (siteId === rootSiteId) return 'same';
  return (await reader.isWithinSubtree(context, siteId, rootSiteId)) === true
    ? 'descendant'
    : 'outside';
}

/**
 * Whether a grant applies to a resource owned by `siteId` (ADR-0018 decision 6): a tenant
 * grant covers every site of its tenant; a site grant covers its own site, and the sites below
 * it only with `includeDescendants`; a platform grant covers no tenant site. Access flows only
 * downward: a grant on a child never covers its parent or a sibling.
 */
export async function grantCoversSite(
  reader: SiteAncestryReader,
  context: CallContext,
  grant: GrantScope,
  siteId: Id<'Site'>,
): Promise<boolean> {
  switch (grant.level) {
    case 'platform':
      return false;
    case 'tenant':
      return true;
    case 'site': {
      if (grant.siteId === siteId) return true;
      if (!grant.includeDescendants) return false;
      return (await siteRelation(reader, context, siteId, grant.siteId)) === 'descendant';
    }
  }
}

/**
 * The sites a set of grants covers, for a list that filters by site in its query (ADR-0025):
 * `all` when one grant is a tenant grant, else every granted site and, for a subtree grant,
 * every site below it. A platform grant covers no site of a tenant. Asks the reader once per
 * subtree grant, one after another.
 */
export async function sitesCoveredBy(
  reader: SiteAncestryReader,
  context: CallContext,
  grants: readonly GrantScope[],
): Promise<'all' | Id<'Site'>[]> {
  if (grants.some((grant) => grant.level === 'tenant')) return 'all';
  const covered = new Set<Id<'Site'>>();
  for (const grant of grants) {
    if (grant.level !== 'site') continue;
    covered.add(grant.siteId);
    if (!grant.includeDescendants) continue;
    for (const siteId of await reader.sitesWithin(context, grant.siteId)) covered.add(siteId);
  }
  return [...covered];
}
