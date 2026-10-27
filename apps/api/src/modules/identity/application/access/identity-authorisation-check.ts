// identity's AuthorisationCheck for the UseCaseGate (ADR-0004 decisions 2 and 7), from the
// PoC 2 spike. One read-only unit per call reads the session, the account's status and its role
// assignments together; nothing is cached, so a revoked role, an ended session or a disabled
// account counts on the next request.
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock } from '@phoenix/shared-kernel';
import type {
  AccessDeclaration,
  AccessDecision,
  AuthorisationCheck,
  PermissionDeclaration,
} from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import type { AssignedRole, SessionRepository } from '../session.repository';
import { holdsEveryKey } from './held-keys';

const DENIED: AccessDecision = Object.freeze({
  allowed: false,
  denial: Object.freeze({ code: 'access.denied' }),
});
const ALLOWED: AccessDecision = Object.freeze({ allowed: true });

/** The part of the permission registry the check reads: the declaration of a key. */
export interface DeclaredPermissions {
  get(key: string): PermissionDeclaration | undefined;
}

export class IdentityAuthorisationCheck implements AuthorisationCheck {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly permissions: DeclaredPermissions,
    private readonly clock: Clock,
  ) {}

  async check(context: CallContext, declaration: AccessDeclaration): Promise<AccessDecision> {
    const { actor, tenant } = context;
    if (actor.kind !== 'authenticated') return DENIED;
    const { rule } = declaration;
    if (rule.kind !== 'permissions' && rule.kind !== 'own-resources') return DENIED;
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
          return ok<AssignedRole[] | null>(null);
        }
        // own-resources needs a live session only; the use case checks ownership.
        if (rule.kind === 'own-resources') return ok<AssignedRole[] | null>([]);
        return ok<AssignedRole[] | null>(
          await this.sessions.assignmentsOf(tenant, actor.accountId),
        );
      },
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return DENIED;
    if (rule.kind === 'own-resources') return ALLOWED;
    const scopeOf = (key: string) => this.permissions.get(key)?.scope;
    return holdsEveryKey(rule.allOf, read.value, actor.population, scopeOf) ? ALLOWED : DENIED;
  }
}
