// Phoenix ADR-0025 (task inbox, owner decision D3): the port that answers which roles an
// account holds and where, for a queue of a role at a site. No template file: Mondapac has no
// role queues.
import type { CallContext, Id } from '@phoenix/shared-kernel';
import type { GrantScope } from './roles/role-model';

/**
 * One role assignment of an account that counts (at its role's level, for a population that
 * may hold the role): the role, where the assignment applies, and every key the role confers.
 */
export interface RoleHolding {
  readonly roleId: Id<'Role'>;
  readonly scope: GrantScope;
  readonly keys: ReadonlySet<string>;
}

/**
 * The port identity implements (ADR-0025): the holdings of an account of the caller's tenant.
 * It reads committed state in a read-only unit of its own and caches nothing, so a revoked role
 * counts on the next request. An account that is not active holds nothing; for the calling
 * actor's own account, a session that ended holds nothing either. Until identity binds it,
 * `AuthzModule` binds the fail-closed placeholder, which answers no holding: no queue admits
 * anybody.
 */
export interface RoleHoldingReader {
  holdingsOf(context: CallContext, accountId: Id<'Account'>): Promise<readonly RoleHolding[]>;
}

/** Nest token of the {@link RoleHoldingReader}. */
export const ROLE_HOLDING_READER = Symbol('ROLE_HOLDING_READER');
