// Phoenix ADR-0018 decision 6: a site-scope key is checked against the resource's site, from
// the actor's grants, never from input. The port through which a module reads those grants
// (identity implements it) and the helper that answers "does a grant of the actor that confers
// `key` cover `siteId`". No template file: Mondapac has no site tree.
import type { CallContext, Id } from '@phoenix/shared-kernel';
import type { PermissionKey } from './access-rule';
import type { GrantScope } from './roles/role-model';
import { grantCoversSite, type SiteAncestryReader } from './site-scope';

/** One role assignment of the actor: its role, where it applies, every key its role confers. */
export interface ActorGrant {
  readonly roleId: Id<'Role'>;
  readonly scope: GrantScope;
  readonly keys: ReadonlySet<string>;
}

/**
 * The actor's grants (identity implements it): for a staff member with a live session and an
 * active account, every assignment at its role's level; none for any other actor. It reads
 * committed state in a read-only unit of its own and caches nothing. Until identity binds it,
 * `AuthzModule` binds the fail-closed placeholder, which answers no grant.
 */
export interface ActorGrantReader {
  grantsOf(context: CallContext): Promise<readonly ActorGrant[]>;
}

/** Nest token of the {@link ActorGrantReader}. */
export const ACTOR_GRANT_READER = Symbol('ACTOR_GRANT_READER');

/**
 * True when one of `grants` confers `key` and covers `siteId` (a tenant grant covers every
 * site; a site grant its site, and the sites below with `includeDescendants`). The gate has
 * already checked that the actor holds `key` somewhere; this narrows it to the resource.
 */
export async function grantsCoverSite(
  grants: readonly ActorGrant[],
  sites: SiteAncestryReader,
  context: CallContext,
  key: PermissionKey,
  siteId: Id<'Site'>,
): Promise<boolean> {
  for (const grant of grants) {
    if (grant.keys.has(key) && (await grantCoversSite(sites, context, grant.scope, siteId))) {
      return true;
    }
  }
  return false;
}
