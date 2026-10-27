import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// The role of a tenant (ADR-0004 decision 7): its key and the bounds of what a custom role may
// confer. What the keys mean, and who may grant them, is the role model of platform/authz,
// applied by application/roles/. Pure.

/** The scopes a custom role may have: staff roles. Platform roles are the platform team's. */
export const CUSTOM_ROLE_SCOPES = ['tenant', 'site'] as const;
export type CustomRoleScope = (typeof CUSTOM_ROLE_SCOPES)[number];

/** The levels a grant sits at: its role's scope (ADR-0018 decision 6). */
export const GRANT_LEVELS = ['platform', 'tenant', 'site'] as const;

/**
 * The key of the tenant's system role, seeded by the first-administrator command. A seed name,
 * the same in every tenant; it decides nothing (the role's kind does).
 */
export const TENANT_SYSTEM_ROLE_KEY = 'tenant-administrator';

/** The most keys one role may confer: every key of a scope fits, with room to grow. */
export const MAX_ROLE_PERMISSION_KEYS = 128;

export type InvalidRoleValue = {
  readonly code: 'identity.value.invalid';
  readonly field: 'key' | 'permissionKeys';
};

/** Kebab case, 2 to 64 characters, as the database CHECK `role_key_check` repeats. */
const ROLE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The role key in its stored form (trimmed, lower case), or the field's failure. */
export function parseRoleKey(value: string): Result<string, InvalidRoleValue> {
  const key = value.trim().toLowerCase();
  return key.length >= 2 && key.length <= 64 && ROLE_KEY.test(key)
    ? ok(key)
    : err({ code: 'identity.value.invalid', field: 'key' });
}

/**
 * The keys of a role in their stored form: sorted, without duplicates, 1 to
 * {@link MAX_ROLE_PERMISSION_KEYS}, each accepted by `fits` (declared, and of a permission
 * scope the role's scope may hold).
 */
export function parseRolePermissionKeys(
  keys: readonly string[],
  fits: (key: string) => boolean,
): Result<string[], InvalidRoleValue> {
  const distinct = [...new Set(keys)].sort();
  if (
    distinct.length === 0 ||
    distinct.length !== keys.length ||
    distinct.length > MAX_ROLE_PERMISSION_KEYS ||
    !distinct.every(fits)
  ) {
    return err({ code: 'identity.value.invalid', field: 'permissionKeys' });
  }
  return ok(distinct);
}
