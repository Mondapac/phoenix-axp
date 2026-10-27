// identity's FieldRuleReader for platform/authz's FieldPolicy (ADR-0024 decision 5). Like the
// authorisation check: one read-only unit per call reads the session, the account's status
// and its grants with their roles' qualifiers and field rules of one definition; nothing is
// cached, so a changed rule or a revoked role counts on the next request.
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id } from '@phoenix/shared-kernel';
import { roleScopesOf, type FieldGrant, type FieldRuleReader } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import {
  definitionAccessOf,
  effectiveKeysOf,
  grantScopeOf,
  type KeyCatalogue,
} from '../roles/acting-assignments';
import type { AssignmentRecord, RoleRepository } from '../roles/role.repository';
import type { SessionRepository } from '../session.repository';

/**
 * The actor's grants for one definition: only grants at their role's level, of a role scope
 * the actor's population may hold (as held-keys.ts counts them); none for a session that ended
 * or an account that is not active. A failed read answers none: every field hidden.
 */
export class IdentityFieldRuleReader implements FieldRuleReader {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly roles: RoleRepository,
    private readonly catalogue: KeyCatalogue,
    private readonly clock: Clock,
  ) {}

  async grantsFor(
    context: CallContext,
    definitionId: Id<'Definition'>,
  ): Promise<readonly FieldGrant[]> {
    const { actor, tenant } = context;
    if (actor.kind !== 'authenticated') return [];
    const now = this.clock.now();
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const session = await this.sessions.findLiveById(
          tenant,
          actor.sessionId,
          actor.accountId,
          now,
        );
        if (
          session === null ||
          session.accountStatus !== 'active' ||
          session.population !== actor.population
        ) {
          return ok<AssignmentRecord[]>([]);
        }
        return ok(await this.roles.assignmentsForDefinition(tenant, actor.accountId, definitionId));
      },
      { readOnly: true },
    );
    if (!read.ok) return [];
    return read.value
      .filter(
        (assignment) =>
          assignment.level === assignment.role.scope &&
          roleScopesOf(actor.population).includes(assignment.role.scope),
      )
      .map((assignment) => {
        const access = definitionAccessOf(assignment.role, this.catalogue);
        return {
          scope: grantScopeOf(assignment),
          keys: effectiveKeysOf(assignment.role, this.catalogue),
          qualifiers: access.qualifiers,
          fieldRules: access.fieldRules.get(definitionId) ?? new Map(),
        };
      });
  }
}
