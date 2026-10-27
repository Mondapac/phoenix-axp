/**
 * SPIKE (PoC 1, slice 0.6; ADR-0018 decision 6): does a site-scoped role grant cover a site?
 *
 * Pure: the caller loads the grants of the actor and the ancestors of the target site (from the
 * closure table `site_ancestry`, under row-level security, so only the unit's tenant) and asks.
 *
 * Access flows only downward. A grant at site G covers target T only when G is T itself, or G is
 * an ancestor of T and the grant includes descendants. Upward (G below T), sideways (G a sibling
 * or cousin of T) and across tenants (T not in the unit's tenant, so no ancestor rows) never
 * match, because the only sites looked at are T's own ancestors.
 */

/** A role grant as the check reads it. `siteId` null means tenant-wide. */
export interface ScopedGrant {
  readonly siteId: string | null;
  readonly includeDescendants: boolean;
}

/**
 * The ancestors of one target site, the target itself included at depth 0: ancestor id to
 * distance. Empty when the target is not a site of the unit's tenant.
 */
export type AncestorDepths = ReadonlyMap<string, number>;

/** True when the ancestor rows describe an existing site (it is its own ancestor at depth 0). */
export function isKnownSite(ancestors: AncestorDepths): boolean {
  for (const depth of ancestors.values()) if (depth === 0) return true;
  return false;
}

export function grantCoversSite(grant: ScopedGrant, ancestors: AncestorDepths): boolean {
  // A site that does not exist in this tenant is covered by nothing, tenant-wide grants included:
  // the use case answers "not found".
  if (!isKnownSite(ancestors)) return false;
  if (grant.siteId === null) return true;
  const distance = ancestors.get(grant.siteId);
  if (distance === undefined) return false;
  return distance === 0 || grant.includeDescendants;
}

/** True when any of the grants covers the target. */
export function anyGrantCoversSite(
  grants: readonly ScopedGrant[],
  ancestors: AncestorDepths,
): boolean {
  return grants.some((grant) => grantCoversSite(grant, ancestors));
}
