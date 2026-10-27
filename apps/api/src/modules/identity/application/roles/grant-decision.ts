// The decision of assigning or revoking a role (ADR-0004 decision 7, ADR-0018 decision 6),
// without I/O: GrantPolicy.canGrant and canActOn under each grant the actor may act under,
// until one accepts. Tests first (CLAUDE.md working rule 4): grant-decision.spec.ts.
import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import {
  GrantPolicy,
  type ActedOnAccount,
  type CannotActOn,
  type GrantedRole,
  type GrantingActor,
  type GrantScope,
  type NotGrantable,
  type ProtectedKeyCatalogue,
  type SiteRelation,
} from '../../../../platform/authz';

export type GrantRefusal = NotGrantable | CannotActOn;

/**
 * The grant the actor acts under to put `role` on `target` at `scope`, or why none may. A
 * revocation is decided the same way: an actor may take away only what it could hand out.
 *
 * `relations` holds, for each site grant of the actor, the target site's relation to that
 * grant's site, read before the unit (`siteRelation`); a missing one counts as outside.
 */
export function decideGrant(
  actors: readonly GrantingActor[],
  role: GrantedRole,
  target: ActedOnAccount,
  scope: GrantScope,
  relations: ReadonlyMap<Id<'Site'>, SiteRelation>,
  catalogue: ProtectedKeyCatalogue,
): Result<GrantingActor, GrantRefusal> {
  let refusal: GrantRefusal | null = null;
  for (const actor of actors) {
    const siteRelation =
      actor.scope.level === 'site' && scope.level === 'site'
        ? (relations.get(actor.scope.siteId) ?? 'outside')
        : undefined;
    const granted = GrantPolicy.canGrant(
      actor,
      role,
      { accountId: target.accountId, population: target.population },
      siteRelation === undefined ? { scope } : { scope, siteRelation },
      catalogue,
    );
    if (!granted.ok) {
      refusal ??= granted.error;
      continue;
    }
    const actedOn = GrantPolicy.canActOn(actor, target);
    if (!actedOn.ok) {
      refusal ??= actedOn.error;
      continue;
    }
    return ok(actor);
  }
  return err(refusal ?? { code: 'role.not-grantable', reason: 'scope' });
}
