// Adapted from Mondapac apps/api/src/modules/identity/domain/grant-policy.ts (identity design 5.5):
// the same pure domain service with Market and seller adapted to Phoenix's populations and
// scopes. Phoenix additions: the grantee's population must fit the role (a portal user never
// holds a staff or operator role, ADR-0019 decision 2), the grant is placed at the role's own
// level, and a site-scope grantor grants only inside its own subtree (ADR-0018 decision 6).
// Mondapac's Phase 2 seller narrowing (no protected seller keys, no seller system role) is
// dropped with the seller.
import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Population, Result } from '@phoenix/shared-kernel';
import type { SiteRelation } from '../site-scope';
import {
  grantFitsRole,
  populationOfRoleScope,
  roleScopesOf,
  type GrantScope,
  type RoleKind,
  type RoleScope,
} from './role-model';

/**
 * The actor of a grant or of an action on another account: the role assignment it acts under
 * (its role, the role's scope, whether that role is the system role of its scope, and where the
 * assignment applies) and the keys that assignment confers. Read by the caller in the same
 * serializable unit as the change.
 */
export interface GrantingActor {
  readonly accountId: Id<'Account'>;
  readonly population: Population;
  readonly roleId: Id<'Role'>;
  readonly roleScope: RoleScope;
  readonly holdsSystemRole: boolean;
  readonly scope: GrantScope;
  readonly effectiveKeys: ReadonlySet<string>;
}

/** A role being put in place: what it would confer. */
export interface GrantedRole {
  readonly id: Id<'Role'>;
  readonly scope: RoleScope;
  readonly kind: RoleKind;
  /** Every key the role confers: for a system role, every key of its scope. */
  readonly effectiveKeys: ReadonlySet<string>;
}

/** The account a role is granted to. */
export interface Grantee {
  readonly accountId: Id<'Account'>;
  readonly population: Population;
}

/**
 * Where the new grant applies. When both the actor's grant and this one are site grants on
 * different sites, `siteRelation` is the target site's relation to the actor's site, from
 * `siteRelation()` in site-scope.ts; absent, the grant is refused (fail closed).
 */
export interface GrantPlacement {
  readonly scope: GrantScope;
  readonly siteRelation?: SiteRelation;
}

/** The account an actor acts on (assign, remove, disable). */
export interface ActedOnAccount {
  readonly accountId: Id<'Account'>;
  readonly population: Population;
  readonly effectiveKeys: ReadonlySet<string>;
}

/** Which keys are protected: the permission registry, read by the caller. */
export interface ProtectedKeyCatalogue {
  isProtected(key: string): boolean;
}

/** Why a grant is refused: the log reason; the answer is always `role.not-grantable`. */
export type NotGrantableReason =
  | 'population'
  | 'placement'
  | 'scope'
  | 'subtree'
  | 'keys-not-held'
  | 'protected-key'
  | 'system-role';

export type NotGrantable = {
  readonly code: 'role.not-grantable';
  readonly reason: NotGrantableReason;
};
export type CannotActOn =
  { readonly code: 'member.self' } | { readonly code: 'member.outranks-actor' };

const notGrantable = (reason: NotGrantableReason): Result<never, NotGrantable> =>
  err({ code: 'role.not-grantable', reason });

const isSubset = (inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean => {
  for (const key of inner) if (!outer.has(key)) return false;
  return true;
};

/**
 * ADR-0018 decision 6: a grantor acts only within its own subtree. A tenant grant reaches every
 * site; a site grant reaches its own site (and only with `includeDescendants` the sites below
 * it, and only then may it hand out `includeDescendants` on its own site); a platform grant
 * reaches only platform grants.
 */
function withinGrantorReach(actor: GrantScope, placement: GrantPlacement): boolean {
  const target = placement.scope;
  switch (actor.level) {
    case 'platform':
      return target.level === 'platform';
    case 'tenant':
      return target.level === 'tenant' || target.level === 'site';
    case 'site': {
      if (target.level !== 'site') return false;
      if (target.siteId === actor.siteId) {
        return !target.includeDescendants || actor.includeDescendants;
      }
      return actor.includeDescendants && placement.siteRelation === 'descendant';
    }
  }
}

/**
 * `GrantPolicy`: a pure domain service. Every use case that creates or edits a role, assigns
 * one, or issues or accepts an invitation calls {@link canGrant}; assign, remove and disable
 * call {@link canActOn}. The founding assignment of a new tenant is not a grant and does not
 * come here.
 */
export const GrantPolicy = Object.freeze({
  /**
   * Whether `actor` may grant `role` to `grantee` at `placement`, checked in this order:
   *
   * 1. `population`: the grantee's population may hold a role of that scope; a portal user
   *    never holds one (ADR-0019 decision 2);
   * 2. `placement`: the grant sits at the role's own level (a site role on a site);
   * 3. `scope`: the actor's role is of the same population as the role (operators grant
   *    platform roles, staff grant staff roles);
   * 4. `subtree`: the placement is within the actor's own reach (ADR-0018 decision 6);
   * 5. `keys-not-held`: every key the role confers is one the actor holds;
   * 6. `system-role`: a system role needs the actor to hold that same role;
   * 7. `protected-key`: a protected key needs the actor to hold the system role of its scope.
   */
  canGrant(
    actor: GrantingActor,
    role: GrantedRole,
    grantee: Grantee,
    placement: GrantPlacement,
    catalogue: ProtectedKeyCatalogue,
  ): Result<void, NotGrantable> {
    if (!roleScopesOf(grantee.population).includes(role.scope)) return notGrantable('population');
    if (!grantFitsRole(placement.scope, role.scope)) return notGrantable('placement');
    if (
      populationOfRoleScope(actor.roleScope) !== populationOfRoleScope(role.scope) ||
      actor.population !== populationOfRoleScope(actor.roleScope)
    ) {
      return notGrantable('scope');
    }
    if (!withinGrantorReach(actor.scope, placement)) return notGrantable('subtree');
    if (!isSubset(role.effectiveKeys, actor.effectiveKeys)) return notGrantable('keys-not-held');
    if (role.kind === 'system' && !(actor.holdsSystemRole && actor.roleId === role.id)) {
      return notGrantable('system-role');
    }
    const protectedKey = [...role.effectiveKeys].some((key) => catalogue.isProtected(key));
    if (protectedKey && !actor.holdsSystemRole) return notGrantable('protected-key');
    return ok(undefined);
  },

  /**
   * Whether `actor` may act on `target`: never on itself; within one population only when the
   * target's keys are a subset of the actor's. A platform operator acting on staff or portal
   * users, and staff acting on a portal user (who holds no keys), are decided by the gate's
   * permission alone. Staff never act on an operator, and a portal user never acts on anyone.
   * Whether the target's own grants lie inside the actor's subtree is the identity module's
   * check, which reads those grants.
   */
  canActOn(actor: GrantingActor, target: ActedOnAccount): Result<void, CannotActOn> {
    if (target.accountId === actor.accountId) return err({ code: 'member.self' });
    if (actor.population === 'portal-user') return err({ code: 'member.outranks-actor' });
    if (target.population !== actor.population) {
      return actor.population === 'platform-operator' || target.population === 'portal-user'
        ? ok(undefined)
        : err({ code: 'member.outranks-actor' });
    }
    return isSubset(target.effectiveKeys, actor.effectiveKeys)
      ? ok(undefined)
      : err({ code: 'member.outranks-actor' });
  },
});
