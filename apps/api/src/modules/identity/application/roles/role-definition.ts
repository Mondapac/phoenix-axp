// Who may define what a custom role confers (ADR-0004 decision 7: no granting beyond your own
// keys; protected keys only from a system role holder), without I/O. A role definition is a
// grant to whoever later receives the role, so the GrantPolicy rules 5 and 7 apply to its
// author: under their tenant grants, since `identity.roles.manage` is a tenant key.
import { err, ok } from '@phoenix/shared-kernel';
import type { Population, Result } from '@phoenix/shared-kernel';
import type { NotGrantable } from '../../../../platform/authz';
import { grantingActorsOf, type KeyCatalogue } from './acting-assignments';
import type { AssignmentRecord } from './role.repository';

/**
 * Whether an actor with these grants may make a role confer `keys` (or, when changing a role,
 * may change one that conferred `previousKeys`): every key held under one of its tenant grants
 * that confers `manageKey`, and a protected key only under the system role.
 */
export function canDefineRole(
  actor: { readonly accountId: AssignmentRecord['accountId']; readonly population: Population },
  assignments: readonly AssignmentRecord[],
  manageKey: string,
  keys: readonly string[],
  catalogue: KeyCatalogue,
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
    if (!keys.every((key) => grant.effectiveKeys.has(key))) continue;
    if (!grant.holdsSystemRole && keys.some((key) => catalogue.isProtected(key))) {
      refusal = { code: 'role.not-grantable', reason: 'protected-key' };
      continue;
    }
    return ok(undefined);
  }
  return err(refusal);
}
