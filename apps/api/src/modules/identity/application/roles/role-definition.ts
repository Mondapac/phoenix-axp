// Who may define what a custom role confers (ADR-0004 decision 7: no granting beyond your own
// keys; protected keys only from a system role holder), without I/O. A role definition is a
// grant to whoever later receives the role, so the GrantPolicy rules 5 and 7 apply to its
// author: under their tenant grants, since `identity.roles.manage` is a tenant key.
import { err, ok } from '@phoenix/shared-kernel';
import type { Population, Result } from '@phoenix/shared-kernel';
import { GrantPolicy, type DefinitionAccess, type NotGrantable } from '../../../../platform/authz';
import { grantingActorsOf, type KeyCatalogue } from './acting-assignments';
import type { AssignmentRecord } from './role.repository';

/**
 * Whether an actor with these grants may make a role confer `keys` (or, when changing a role,
 * may change one that conferred `previousKeys`): every key held under one of its tenant grants
 * that confers `manageKey`, and a protected key only under the system role. With
 * `systemRoleOnly` (a role that has holders, security review of slice 1.6, M1), only a system
 * role grant may act: changing such a role changes the access of its holders, who may outrank
 * the author. With `definitionAccess` (the qualifiers and field rules the role will hold), they
 * must be no wider than what that same grant holds (ADR-0024 decision 10).
 */
export function canDefineRole(
  actor: { readonly accountId: AssignmentRecord['accountId']; readonly population: Population },
  assignments: readonly AssignmentRecord[],
  manageKey: string,
  keys: readonly string[],
  catalogue: KeyCatalogue,
  systemRoleOnly = false,
  definitionAccess?: DefinitionAccess,
): Result<void, NotGrantable> {
  const tenantGrants = grantingActorsOf(
    actor.accountId,
    actor.population,
    assignments,
    manageKey,
    catalogue,
  ).filter((grant) => grant.scope.level === 'tenant');
  let refusal: NotGrantable = { code: 'role.not-grantable', reason: 'keys-not-held' };
  for (const grant of tenantGrants) {
    if (systemRoleOnly && !grant.holdsSystemRole) {
      refusal = { code: 'role.not-grantable', reason: 'system-role' };
      continue;
    }
    if (!keys.every((key) => grant.effectiveKeys.has(key))) continue;
    if (!grant.holdsSystemRole && keys.some((key) => catalogue.isProtected(key))) {
      refusal = { code: 'role.not-grantable', reason: 'protected-key' };
      continue;
    }
    if (definitionAccess !== undefined) {
      const within = GrantPolicy.canGrantDefinitionAccess(grant, {
        effectiveKeys: new Set(keys),
        definitionAccess,
      });
      if (!within.ok) {
        refusal = within.error;
        continue;
      }
    }
    return ok(undefined);
  }
  return err(refusal);
}
