// identity's RoleHoldingReader for the task inbox of the process module (ADR-0025). Like the
// field-rule reader: one read-only unit per call reads the account's status (and, for the
// caller's own account, its live session) and its grants with their roles; nothing is cached,
// so a revoked role or a disabled account counts on the next request.
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Population } from '@phoenix/shared-kernel';
import { roleScopesOf, type RoleHolding, type RoleHoldingReader } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import type { AccountRepository } from '../account.repository';
import { effectiveKeysOf, grantScopeOf, type KeyCatalogue } from '../roles/acting-assignments';
import type { AssignmentRecord, RoleRepository } from '../roles/role.repository';
import type { SessionRepository } from '../session.repository';

interface Holder {
  readonly population: Population | null;
  readonly assignments: readonly AssignmentRecord[];
}

const NOBODY: Holder = Object.freeze({ population: null, assignments: [] });

/**
 * The holdings of an active account of the caller's tenant: only grants at their role's level,
 * of a role scope the account's population may hold (as held-keys.ts counts them). None for an
 * account that is not active, or, when the caller asks about itself, for a session that ended.
 * A failed read answers none: no queue admits the account.
 */
export class IdentityRoleHoldingReader implements RoleHoldingReader {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly roles: RoleRepository,
    private readonly catalogue: KeyCatalogue,
    private readonly clock: Clock,
  ) {}

  async holdingsOf(
    context: CallContext,
    accountId: Id<'Account'>,
  ): Promise<readonly RoleHolding[]> {
    const { actor, tenant } = context;
    // Only staff ask, about accounts of their own tenant (the unit's tenant).
    if (actor.kind !== 'authenticated') return [];
    const now = this.clock.now();
    const read = await this.unitOfWork.run<Holder, never>(
      tenant,
      async () => {
        const account = await this.accounts.find(tenant, accountId);
        if (account === null || account.status !== 'active') {
          return ok(NOBODY);
        }
        if (accountId === actor.accountId) {
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
            return ok(NOBODY);
          }
        }
        return ok({
          population: account.population,
          assignments: await this.roles.assignmentsOf(tenant, accountId),
        });
      },
      { readOnly: true },
    );
    if (!read.ok || read.value.population === null) return [];
    const { population, assignments } = read.value;
    return assignments
      .filter(
        (assignment) =>
          assignment.level === assignment.role.scope &&
          roleScopesOf(population).includes(assignment.role.scope),
      )
      .map((assignment) => ({
        roleId: assignment.role.id,
        scope: grantScopeOf(assignment),
        keys: effectiveKeysOf(assignment.role, this.catalogue),
      }));
  }
}
