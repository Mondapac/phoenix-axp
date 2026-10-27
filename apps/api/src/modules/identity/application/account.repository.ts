import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { Account, AccountSource, AccountStatus } from '../domain/account';

export interface AccountListItem extends Account {
  readonly createdAt: Temporal.Instant;
}

/** The staff accounts of one tenant (`identity.account`). Every method runs inside a unit. */
export interface AccountRepository {
  find(tenant: TenantContext, id: Id<'Account'>): Promise<Account | null>;
  findBySubject(tenant: TenantContext, subject: string): Promise<Account | null>;
  findByUsername(tenant: TenantContext, username: string): Promise<Account | null>;
  /** Every account of the tenant, by username. */
  list(tenant: TenantContext): Promise<AccountListItem[]>;
  /** `taken` when another account of the tenant has the username or the subject. */
  insert(
    tenant: TenantContext,
    account: {
      readonly id: Id<'Account'>;
      readonly source: AccountSource;
      readonly subject: string | null;
      readonly username: string;
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'>;
  /** Sets the subject of a local account that has none. Throws StaleAggregateError otherwise. */
  link(
    tenant: TenantContext,
    id: Id<'Account'>,
    expectedVersion: number,
    subject: string,
    at: Temporal.Instant,
  ): Promise<void>;
  /** Up to `limit` directory staff accounts after `afterId`, by id. */
  directoryAccounts(
    tenant: TenantContext,
    afterId: Id<'Account'> | null,
    limit: number,
  ): Promise<DirectoryAccount[]>;
  /**
   * Sets the status of an account still at `expectedVersion` and still in the other status;
   * false when it changed meanwhile (the sync then leaves it to its next run).
   */
  setStatusIfUnchanged(
    tenant: TenantContext,
    id: Id<'Account'>,
    expectedVersion: number,
    status: AccountStatus,
    at: Temporal.Instant,
  ): Promise<boolean>;
  /** Throws StaleAggregateError on another version. */
  disable(
    tenant: TenantContext,
    id: Id<'Account'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<void>;
}

/** A directory account as the sync reads it. */
export interface DirectoryAccount {
  readonly id: Id<'Account'>;
  readonly subject: string;
  readonly status: AccountStatus;
  readonly version: number;
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
