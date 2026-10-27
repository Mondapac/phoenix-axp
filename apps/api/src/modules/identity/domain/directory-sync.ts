import { err, ok } from '@phoenix/shared-kernel';
import type { Result, Temporal } from '@phoenix/shared-kernel';
import type { AccountStatus } from './account';

// The staff directory sync (ADR-0022 decision 6; PoC 2 verdict 5). Keycloak sends nothing when a
// user is disabled or removed in AD, so a periodic sync per tenant compares every directory
// account with the directory and applies the difference. Pure.

/** The owner's default (P6): five minutes between runs. */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
/** The bounds of the tenant setting, fixed in slice 1.5 (ADR-0022 decision 6). */
export const MIN_SYNC_INTERVAL_MINUTES = 1;
export const MAX_SYNC_INTERVAL_MINUTES = 60;

export type InvalidInterval = {
  readonly code: 'identity.value.invalid';
  readonly field: 'intervalMinutes';
};

export function parseSyncInterval(minutes: number): Result<number, InvalidInterval> {
  return Number.isInteger(minutes) &&
    minutes >= MIN_SYNC_INTERVAL_MINUTES &&
    minutes <= MAX_SYNC_INTERVAL_MINUTES
    ? ok(minutes)
    : err({ code: 'identity.value.invalid', field: 'intervalMinutes' });
}

/** Whether a scheduled run is due: never ran, or the interval has passed since the last start. */
export function isSyncDue(
  lastStartedAt: Temporal.Instant | null,
  intervalMinutes: number,
  now: Temporal.Instant,
): boolean {
  return (
    lastStartedAt === null ||
    lastStartedAt.add({ minutes: intervalMinutes }).epochMilliseconds <= now.epochMilliseconds
  );
}

/** How a run ended: applied, stopped by the directory, or stopped by the safety stop. */
export const SYNC_OUTCOMES = ['completed', 'failed', 'halted'] as const;
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

/** What the directory says about one user: enabled, disabled, or not there at all. */
export type DirectoryStatus = 'enabled' | 'disabled' | 'missing';

/** The change one directory account needs. */
export type SyncChange = 'disable' | 'enable' | 'none';

/**
 * A directory account follows its directory user: disabled or missing there disables it here;
 * enabled there re-enables an account the sync disabled. Its sessions are not restored: a
 * re-enabled person signs in again.
 */
export function syncChangeOf(account: AccountStatus, directory: DirectoryStatus): SyncChange {
  if (directory === 'enabled') return account === 'disabled' ? 'enable' : 'none';
  return account === 'active' ? 'disable' : 'none';
}

/**
 * The safety stop of a run: when a large share of the accounts checked would be disabled at
 * once, the directory link is more likely broken (a wrong base DN, an LDAP outage reported as
 * "not found") than the people gone, so the run halts before changing anything and reports
 * `halted`. Applies from {@link HALT_MIN_CHECKED} accounts, above {@link HALT_SHARE}.
 */
export const HALT_MIN_CHECKED = 10;
export const HALT_SHARE = 0.5;

export function shouldHalt(checked: number, toDisable: number): boolean {
  return checked >= HALT_MIN_CHECKED && toDisable > checked * HALT_SHARE;
}
