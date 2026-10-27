// The decision of identity's AuthorisationCheck (ADR-0004 decisions 6 and 7, ADR-0018
// decision 6), without I/O: whether an account's role assignments confer every key of a
// `permissions` rule. Tests first (CLAUDE.md working rule 4): held-keys.spec.ts.
import type { Population } from '@phoenix/shared-kernel';
import {
  permissionScopesOfRole,
  roleScopesOf,
  type PermissionScope,
  type RoleScope,
} from '../../../../platform/authz';
import type { AssignedRole } from '../session.repository';

/** The declared scope of a key; undefined for a key the registry does not declare. */
export type KeyScopeLookup = (key: string) => PermissionScope | undefined;

/** Whether one assignment confers `key` of `scope`. */
function confers(
  assignment: AssignedRole,
  population: Population,
  key: string,
  scope: PermissionScope,
): boolean {
  const role: RoleScope = assignment.roleScope;
  // A grant sits at its role's level, and only a population that may hold the role holds it.
  if (assignment.level !== role || !roleScopesOf(population).includes(role)) return false;
  if (!permissionScopesOfRole(role).includes(scope)) return false;
  // A system role holds every key of its scope by definition; another role its listed keys.
  return assignment.roleKind === 'system' || assignment.permissionKeys.includes(key);
}

/**
 * True when every key is declared and conferred by at least one assignment. A tenant
 * assignment confers tenant and site keys for the whole tenant; a site assignment confers site
 * keys "somewhere in the tenant" (the use case then checks the resource's site with
 * `grantCoversSite`); a platform assignment confers platform keys. An unknown key, or an
 * empty key list, grants nothing.
 */
export function holdsEveryKey(
  keys: readonly string[],
  assignments: readonly AssignedRole[],
  population: Population,
  scopeOf: KeyScopeLookup,
): boolean {
  if (keys.length === 0) return false;
  return keys.every((key) => {
    const scope = scopeOf(key);
    return (
      scope !== undefined &&
      assignments.some((assignment) => confers(assignment, population, key, scope))
    );
  });
}
