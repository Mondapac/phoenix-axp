import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { AccountStatus } from '../../domain/account';
import type { PortalMethod, PortalSignInSettings } from '../../domain/portal';

/** A code as stored: hashes only (ADR-0026 decision 3). */
export interface StoredPortalCode {
  readonly id: Id<'PortalCode'>;
  readonly kind: PortalMethod;
  readonly lookupHash: Buffer;
  readonly codeHash: Buffer;
  readonly failures: number;
  readonly expiresAt: Temporal.Instant;
  readonly spent: boolean;
}

/** A portal account found by an address. */
export interface PortalAccountRef {
  readonly accountId: Id<'Account'>;
  readonly status: AccountStatus;
}

/** A portal account with its sealed addresses. */
export interface PortalAccountRecord extends PortalAccountRef {
  readonly contacts: readonly { readonly kind: PortalMethod; readonly sealed: Buffer }[];
}

/**
 * Portal sign-in records of one tenant (`identity.portal_*`, and the portal accounts of
 * `identity.account`). Every method runs inside a unit.
 */
export interface PortalRepository {
  /** The tenant's settings; {@link CLOSED_PORTAL} when none were saved. */
  settings(tenant: TenantContext): Promise<PortalSignInSettings>;
  /** Saves at `expectedVersion` (0: first save). Throws StaleAggregateError otherwise. */
  saveSettings(
    tenant: TenantContext,
    settings: Omit<PortalSignInSettings, 'version'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<void>;

  insertCode(
    tenant: TenantContext,
    code: {
      readonly id: Id<'PortalCode'>;
      readonly kind: PortalMethod;
      readonly lookupHash: Buffer;
      readonly codeHash: Buffer;
      readonly expiresAt: Temporal.Instant;
    },
    at: Temporal.Instant,
  ): Promise<void>;
  findCode(tenant: TenantContext, id: Id<'PortalCode'>): Promise<StoredPortalCode | null>;
  /**
   * Counts a wrong answer if the code still has `expectedFailures` and is unspent; `spentAt`
   * spends it with it. False when a concurrent answer changed it first.
   */
  recordFailure(
    tenant: TenantContext,
    id: Id<'PortalCode'>,
    expectedFailures: number,
    spentAt: Temporal.Instant | null,
  ): Promise<boolean>;
  /** Spends an unspent code; false when a concurrent answer spent it first. */
  spendCode(tenant: TenantContext, id: Id<'PortalCode'>, at: Temporal.Instant): Promise<boolean>;
  /** Deletes the codes that expired before `before`; how many. */
  pruneCodes(tenant: TenantContext, before: Temporal.Instant): Promise<number>;

  findByAddress(
    tenant: TenantContext,
    kind: PortalMethod,
    lookupHash: Buffer,
  ): Promise<PortalAccountRef | null>;
  /**
   * A new active portal account with its first address; `taken` when another account of the
   * tenant has the address (a concurrent first sign-in).
   */
  insertAccount(
    tenant: TenantContext,
    account: {
      readonly id: Id<'Account'>;
      readonly kind: PortalMethod;
      readonly lookupHash: Buffer;
      readonly sealed: Buffer;
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'>;
  /** A portal account, or null for any other account or none. */
  findAccount(tenant: TenantContext, id: Id<'Account'>): Promise<PortalAccountRecord | null>;
}

export const PORTAL_REPOSITORY = Symbol('PORTAL_REPOSITORY');
