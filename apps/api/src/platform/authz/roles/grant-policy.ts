// Adapted from Mondapac apps/api/src/modules/identity/domain/grant-policy.ts (identity design 5.5):
// the same pure domain service with Market and seller adapted to Phoenix's populations and
// scopes. Phoenix additions: the grantee's population must fit the role (a portal user never
// holds a staff or operator role, ADR-0019 decision 2), the grant is placed at the role's own
// level, and a site-scope grantor grants only inside its own subtree (ADR-0018 decision 6).
// Mondapac's Phase 2 seller narrowing (no protected seller keys, no seller system role) is
// dropped with the seller.
import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Population, Result } from '@phoenix/shared-kernel';
import { qualifierWithin, type DefinitionQualifier } from '../definition-scope';
import type { FieldMode } from '../field-policy';
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
 * What a role holds over run-time definitions (ADR-0024 decisions 2 and 3): the qualifier of
 * each qualified key, and its field rules per definition. Absent, a role holds no qualifier
 * and no rule.
 */
export interface DefinitionAccess {
  readonly qualifiers: ReadonlyMap<string, DefinitionQualifier>;
  readonly fieldRules: ReadonlyMap<Id<'Definition'>, ReadonlyMap<Id<'Field'>, FieldMode>>;
}

export const NO_DEFINITION_ACCESS: DefinitionAccess = Object.freeze({
  qualifiers: new Map<string, DefinitionQualifier>(),
  fieldRules: new Map<Id<'Definition'>, ReadonlyMap<Id<'Field'>, FieldMode>>(),
});

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
  /** The definition access of the actor's role; absent, none. */
  readonly definitionAccess?: DefinitionAccess;
}

/** A role being put in place: what it would confer. */
export interface GrantedRole {
  readonly id: Id<'Role'>;
  readonly scope: RoleScope;
  readonly kind: RoleKind;
  /** Every key the role confers: for a system role, every key of its scope. */
  readonly effectiveKeys: ReadonlySet<string>;
  /** The definition access the role confers; absent, none. */
  readonly definitionAccess?: DefinitionAccess;
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
  /**
   * What each of the target's roles holds over definitions (ADR-0024); absent, none. Within
   * one population, each must lie within the actor's (security review of slice 2.0, M2).
   */
  readonly definitionGrants?: readonly {
    readonly effectiveKeys: ReadonlySet<string>;
    readonly definitionAccess?: DefinitionAccess;
  }[];
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
  | 'definition'
  | 'field-rules'
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

const RANK: Readonly<Record<FieldMode, number>> = { hidden: 0, read: 1, edit: 2 };

/** True when a role's own qualifiers of `keys` cover `definitionId`. */
function roleCovers(
  access: DefinitionAccess,
  keys: ReadonlySet<string>,
  definitionId: Id<'Definition'>,
): boolean {
  for (const [key, qualifier] of access.qualifiers) {
    if (keys.has(key) && (qualifier.all || qualifier.definitionIds.has(definitionId))) return true;
  }
  return false;
}

/**
 * Whether one field's mode in the role is provably no wider than in the actor's role. A field
 * without a rule follows the operation (and is hidden when sensitive), which only a rule of
 * `edit` on the other side bounds; so an opening rule (`read`, `edit`) needs the actor to hold
 * at least that rule itself, and a field the actor's rule narrows needs the same narrowing in
 * the role.
 */
function fieldWithin(role: FieldMode | undefined, actor: FieldMode | undefined): boolean {
  if (role !== undefined && actor !== undefined) return RANK[role] <= RANK[actor];
  if (role !== undefined) return role === 'hidden';
  return actor === undefined || actor === 'edit';
}

/**
 * ADR-0024 decision 10: nobody grants wider than they hold. Every qualifier of a key the role
 * confers lies within the actor's qualifier of that key, and on every definition the role
 * covers, every field is provably no wider than for the actor. The holder of a system role
 * holds every definition and every field.
 */
function definitionAccessWithin(
  actor: GrantingActor,
  role: {
    readonly effectiveKeys: ReadonlySet<string>;
    readonly definitionAccess?: DefinitionAccess;
  },
): Result<void, NotGrantable> {
  if (actor.holdsSystemRole) return ok(undefined);
  const held = actor.definitionAccess ?? NO_DEFINITION_ACCESS;
  const given = role.definitionAccess ?? NO_DEFINITION_ACCESS;
  for (const [key, qualifier] of given.qualifiers) {
    if (!role.effectiveKeys.has(key)) continue;
    const own = held.qualifiers.get(key);
    if (own === undefined || !qualifierWithin(qualifier, own)) return notGrantable('definition');
  }
  const definitions = new Set([...given.fieldRules.keys(), ...held.fieldRules.keys()]);
  for (const definitionId of definitions) {
    if (!roleCovers(given, role.effectiveKeys, definitionId)) continue;
    const roleRules = given.fieldRules.get(definitionId) ?? new Map<Id<'Field'>, FieldMode>();
    const actorRules = held.fieldRules.get(definitionId) ?? new Map<Id<'Field'>, FieldMode>();
    for (const fieldId of new Set([...roleRules.keys(), ...actorRules.keys()])) {
      if (!fieldWithin(roleRules.get(fieldId), actorRules.get(fieldId))) {
        return notGrantable('field-rules');
      }
    }
  }
  return ok(undefined);
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
   *    `definition` and `field-rules`: its qualifiers and field modes are no wider than the
   *    actor's (ADR-0024 decision 10);
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
    const withinAccess = definitionAccessWithin(actor, role);
    if (!withinAccess.ok) return withinAccess;
    if (role.kind === 'system' && !(actor.holdsSystemRole && actor.roleId === role.id)) {
      return notGrantable('system-role');
    }
    const protectedKey = [...role.effectiveKeys].some((key) => catalogue.isProtected(key));
    if (protectedKey && !actor.holdsSystemRole) return notGrantable('protected-key');
    return ok(undefined);
  },

  /**
   * Rule 5's definition part alone, for the author of a role definition: whether a role that
   * confers `effectiveKeys` with `definitionAccess` stays within what `actor` holds.
   */
  canGrantDefinitionAccess(
    actor: GrantingActor,
    role: {
      readonly effectiveKeys: ReadonlySet<string>;
      readonly definitionAccess?: DefinitionAccess;
    },
  ): Result<void, NotGrantable> {
    return definitionAccessWithin(actor, role);
  },

  /**
   * Whether `actor` may act on `target`: never on itself; within one population only when the
   * target's keys are a subset of the actor's and each of its roles' definition access lies
   * within the actor's. A platform operator acting on staff or portal
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
    if (!isSubset(target.effectiveKeys, actor.effectiveKeys)) {
      return err({ code: 'member.outranks-actor' });
    }
    for (const held of target.definitionGrants ?? []) {
      if (!definitionAccessWithin(actor, held).ok) return err({ code: 'member.outranks-actor' });
    }
    return ok(undefined);
  },
});
