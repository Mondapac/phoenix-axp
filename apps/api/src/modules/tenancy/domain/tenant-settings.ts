import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import type { InvalidValue } from './values';

/** Where a tenant's staff sign in (ADR-0019): its directory (AD or LDAP), local accounts, or both. */
export const SIGN_IN_SOURCES = ['directory', 'local'] as const;
export type SignInSource = (typeof SIGN_IN_SOURCES)[number];

/** The ceiling of the site tree when the tenant has not set one (ADR-0018 decision 2). */
export const DEFAULT_MAX_SITE_DEPTH = 8;
/** The highest ceiling a tenant may set; the database CHECK repeats it. */
export const MAX_SITE_DEPTH_LIMIT = 32;

/** The tenant's editable settings. */
export interface TenantSettings {
  readonly signInSources: readonly SignInSource[];
  readonly maxSiteDepth: number;
  /** 1 for the defaults: the row is created at version 1, by a first save or a tree change. */
  readonly version: number;
}

/**
 * The settings of a tenant that never saved any. Local accounts only: a directory source needs
 * the tenant's LDAP connection, which identity (slice 1.5) configures.
 */
export const DEFAULT_TENANT_SETTINGS: TenantSettings = Object.freeze({
  signInSources: Object.freeze(['local'] as const),
  maxSiteDepth: DEFAULT_MAX_SITE_DEPTH,
  version: 1,
});

/** One or both sources, no duplicates, stored in the order of {@link SIGN_IN_SOURCES}. */
export function parseSignInSources(
  values: readonly string[],
): Result<readonly SignInSource[], InvalidValue> {
  const known = new Set<string>(SIGN_IN_SOURCES);
  if (
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => !known.has(value))
  ) {
    return err({ code: 'tenancy.value.invalid', field: 'signInSources' });
  }
  return ok(SIGN_IN_SOURCES.filter((source) => values.includes(source)));
}

export function parseMaxSiteDepth(value: number): Result<number, InvalidValue> {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SITE_DEPTH_LIMIT
    ? ok(value)
    : err({ code: 'tenancy.value.invalid', field: 'maxSiteDepth' });
}
