import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { SyncOutcome } from '../domain/directory-sync';

export interface DirectorySyncState {
  readonly intervalMinutes: number;
  readonly lastStartedAt: Temporal.Instant | null;
  readonly lastOutcome: SyncOutcome | null;
  readonly lastFinishedAt: Temporal.Instant | null;
  readonly accountsChecked: number;
  readonly accountsDisabled: number;
  readonly accountsEnabled: number;
  /** Optimistic concurrency of the settings (the interval) only. */
  readonly version: number;
}

/**
 * The tenant's directory sync row (`identity.directory_sync`), with the defaults while it does
 * not exist. Every method runs inside a unit.
 */
export interface DirectorySyncRepository {
  read(tenant: TenantContext): Promise<DirectorySyncState>;
  /**
   * Marks a run started at `at` when the last start is still `expectedLastStartedAt`; false when
   * another run came first. A claim leaves `version` alone, so a run never makes a studio
   * settings change stale. Creates the row on first need.
   */
  claim(
    tenant: TenantContext,
    expectedLastStartedAt: Temporal.Instant | null,
    at: Temporal.Instant,
  ): Promise<boolean>;
  finish(
    tenant: TenantContext,
    outcome: SyncOutcome,
    counts: { readonly checked: number; readonly disabled: number; readonly enabled: number },
    at: Temporal.Instant,
  ): Promise<void>;
  /** Throws StaleAggregateError on another version. Creates the row on first need. */
  saveInterval(
    tenant: TenantContext,
    expectedVersion: number,
    intervalMinutes: number,
    at: Temporal.Instant,
  ): Promise<void>;
}

export const DIRECTORY_SYNC_REPOSITORY = Symbol('DIRECTORY_SYNC_REPOSITORY');
