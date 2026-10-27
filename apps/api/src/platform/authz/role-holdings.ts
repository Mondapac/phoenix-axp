// Phoenix ADR-0025 (task inbox, owner decision D3): the port that answers which roles an
// account holds and where, for a queue of a role at a site. No template file: Mondapac has no
// role queues.
import type { CallContext, Id } from '@phoenix/shared-kernel';
import type { ActorGrant } from './actor-grants';

/**
 * One role assignment of an account that counts (at its role's level, for a population that
 * may hold the role): the same shape as the actor's own grants (ADR-0018 decision 6), read here
 * for any account of the tenant, such as an assignee a supervisor names.
 */
export type RoleHolding = ActorGrant;

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
