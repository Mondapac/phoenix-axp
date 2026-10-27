import type { Id, Population, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { AccountStatus } from '../domain/account';
import type { RoleKind, RoleScope } from '../../../platform/authz';

/** A live session with the state of its account, read in one statement. */
export interface LiveSession {
  readonly sessionId: Id<'Session'>;
  readonly accountId: Id<'Account'>;
  readonly population: Population;
  readonly accountStatus: AccountStatus;
}

/** One role assignment of an account, with what its role confers. */
export interface AssignedRole {
  readonly level: RoleScope;
  readonly siteId: Id<'Site'> | null;
  readonly includeDescendants: boolean;
  readonly roleKind: RoleKind;
  readonly roleScope: RoleScope;
  readonly permissionKeys: readonly string[];
}

/**
 * The sessions of one tenant (`identity.session`) and the access state read for each request:
 * the session, its account and the account's role assignments. Nothing here is cached. Every
 * method runs inside a unit.
 */
export interface SessionRepository {
  /** The session with this token hash that has not expired at `now`, or null. */
  findLive(
    tenant: TenantContext,
    tokenHash: Buffer,
    now: Temporal.Instant,
  ): Promise<LiveSession | null>;
  /** The session `sessionId` of `accountId` if it has not expired at `now`, or null. */
  findLiveById(
    tenant: TenantContext,
    sessionId: Id<'Session'>,
    accountId: Id<'Account'>,
    now: Temporal.Instant,
  ): Promise<LiveSession | null>;
  /** The role assignments of an account, with their roles. */
  assignmentsOf(tenant: TenantContext, accountId: Id<'Account'>): Promise<AssignedRole[]>;
  insert(
    tenant: TenantContext,
    session: {
      readonly id: Id<'Session'>;
      readonly accountId: Id<'Account'>;
      readonly tokenHash: Buffer;
      readonly idpSessionId: string | null;
      readonly expiresAt: Temporal.Instant;
    },
    at: Temporal.Instant,
  ): Promise<void>;
  /** Ends one session of an account; false when there was none. */
  end(tenant: TenantContext, sessionId: Id<'Session'>, accountId: Id<'Account'>): Promise<boolean>;
  /** Ends every session of an account; the number ended. */
  endAllOf(tenant: TenantContext, accountId: Id<'Account'>): Promise<number>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
