// identity's ActorGrantReader for platform/authz (ADR-0018 decision 6). Like the field-rule
// reader: one read-only unit per call reads the session, the account's status and its role
// assignments; nothing is cached, so a revoked role counts on the next request.
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock } from '@phoenix/shared-kernel';
import { roleScopesOf, type ActorGrant, type ActorGrantReader } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { effectiveKeysOf, grantScopeOf, type KeyCatalogue } from '../roles/acting-assignments';
import type { AssignmentRecord, RoleRepository } from '../roles/role.repository';
import type { SessionRepository } from '../session.repository';

/**
 * The actor's grants: only grants at their role's level, of a role scope the actor's
 * population may hold (as held-keys.ts counts them); none for a session that ended, an account
 * that is not active, or any actor that is not signed in. A failed read answers none.
 */
export class IdentityActorGrantReader implements ActorGrantReader {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly roles: RoleRepository,
    private readonly catalogue: KeyCatalogue,
    private readonly clock: Clock,
  ) {}

  async grantsOf(context: CallContext): Promise<readonly ActorGrant[]> {
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
        return ok(await this.roles.assignmentsOf(tenant, actor.accountId));
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
      .map((assignment) => ({
        roleId: assignment.role.id,
        scope: grantScopeOf(assignment),
        keys: effectiveKeysOf(assignment.role, this.catalogue),
      }));
  }
}
