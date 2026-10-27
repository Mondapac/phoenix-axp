// How identity applies the role model of platform/authz (ADR-0004 decision 7, ADR-0018
// decision 6) to stored grants, without I/O: the keys a grant confers, and the grants an actor
// may act under. Tests first (CLAUDE.md working rule 4): acting-assignments.spec.ts.
import type { Id, Population } from '@phoenix/shared-kernel';
import {
  permissionScopesOfRole,
  roleScopesOf,
  type GrantingActor,
  type GrantScope,
  type PermissionDeclaration,
  type PermissionScope,
  type ProtectedKeyCatalogue,
  type RoleKind,
  type RoleScope,
} from '../../../../platform/authz';
import type { AssignmentRecord } from './role.repository';

/** The part of the permission registry the role rules read. */
export interface KeyCatalogue extends ProtectedKeyCatalogue {
  get(key: string): PermissionDeclaration | undefined;
  keysOf(scope: PermissionScope): ReadonlySet<string>;
}

/**
 * The keys a role confers: a system role every declared key of the permission scopes its
 * scope may hold; another role its listed keys that are declared and of such a scope. An
 * unknown or retired key confers nothing.
 */
export function effectiveKeysOf(
  role: {
    readonly kind: RoleKind;
    readonly scope: RoleScope;
    readonly permissionKeys: readonly string[];
  },
  catalogue: KeyCatalogue,
): ReadonlySet<string> {
  const scopes = permissionScopesOfRole(role.scope);
  if (role.kind === 'system') {
    return new Set(scopes.flatMap((scope) => [...catalogue.keysOf(scope)]));
  }
  return new Set(
    role.permissionKeys.filter((key) => {
      const scope = catalogue.get(key)?.scope;
      return scope !== undefined && scopes.includes(scope);
    }),
  );
}

/** True when `key` fits a role of `scope`: declared, and of a permission scope it may hold. */
export function keyFitsRole(key: string, scope: RoleScope, catalogue: KeyCatalogue): boolean {
  const declared = catalogue.get(key)?.scope;
  return declared !== undefined && permissionScopesOfRole(scope).includes(declared);
}

/** Where a stored grant applies. */
export function grantScopeOf(assignment: AssignmentRecord): GrantScope {
  if (assignment.level === 'site' && assignment.siteId !== null) {
    return {
      level: 'site',
      siteId: assignment.siteId,
      includeDescendants: assignment.includeDescendants,
    };
  }
  return assignment.level === 'platform' ? { level: 'platform' } : { level: 'tenant' };
}

/** A grant counts only at its role's level and for a population that may hold the role. */
function counts(assignment: AssignmentRecord, population: Population): boolean {
  return (
    assignment.level === assignment.role.scope &&
    roleScopesOf(population).includes(assignment.role.scope)
  );
}

/** Every key the grants of an account confer, wherever they apply. */
export function heldKeysOf(
  assignments: readonly AssignmentRecord[],
  population: Population,
  catalogue: KeyCatalogue,
): ReadonlySet<string> {
  const held = new Set<string>();
  for (const assignment of assignments) {
    if (!counts(assignment, population)) continue;
    for (const key of effectiveKeysOf(assignment.role, catalogue)) held.add(key);
  }
  return held;
}

/**
 * The grants an actor may act under for an action that needs `key`: each grant that counts
 * and confers the key, as a GrantPolicy actor, system-role grants first. A use case tries them
 * in order and acts under the first one the policy accepts.
 */
export function grantingActorsOf(
  accountId: Id<'Account'>,
  population: Population,
  assignments: readonly AssignmentRecord[],
  key: string,
  catalogue: KeyCatalogue,
): GrantingActor[] {
  return assignments
    .filter((assignment) => counts(assignment, population))
    .map((assignment) => ({
      accountId,
      population,
      roleId: assignment.role.id,
      roleScope: assignment.role.scope,
      holdsSystemRole: assignment.role.kind === 'system',
      scope: grantScopeOf(assignment),
      effectiveKeys: effectiveKeysOf(assignment.role, catalogue),
    }))
    .filter((actor) => actor.effectiveKeys.has(key))
    .sort((a, b) => Number(b.holdsSystemRole) - Number(a.holdsSystemRole));
}
