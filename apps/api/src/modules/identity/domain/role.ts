import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';

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

/** The most field rules a role may hold for one definition (ADR-0024 decision 3). */
export const MAX_FIELD_RULES = 256;

/**
 * The most definitions one role may hold field rules for: every grant decision reads them all
 * (security review of slice 2.0, L4).
 */
export const MAX_RULED_DEFINITIONS = 64;

/**
 * The field modes and the qualifier bound of platform/authz's field policy, repeated here
 * because domain/ imports nothing outside itself; role.spec.ts proves they are equal.
 */
export const ROLE_FIELD_MODES = ['hidden', 'read', 'edit'] as const;
export type RoleFieldMode = (typeof ROLE_FIELD_MODES)[number];
export const MAX_ROLE_QUALIFIER_DEFINITIONS = 256;

export type InvalidRoleValue = {
  readonly code: 'identity.value.invalid';
  readonly field: 'key' | 'permissionKeys' | 'permissionKey' | 'definitionIds' | 'fieldRules';
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

/**
 * The listed definitions of a qualifier in their stored form: sorted, without duplicates, 1 to
 * {@link MAX_ROLE_QUALIFIER_DEFINITIONS}. The definitions are another module's; an id that names
 * none covers nothing.
 */
export function parseQualifierDefinitions(
  ids: readonly Id<'Definition'>[],
): Result<Id<'Definition'>[], InvalidRoleValue> {
  const distinct = [...new Set(ids)].sort();
  return distinct.length > 0 &&
    distinct.length === ids.length &&
    distinct.length <= MAX_ROLE_QUALIFIER_DEFINITIONS
    ? ok(distinct)
    : err({ code: 'identity.value.invalid', field: 'definitionIds' });
}

/** A field rule as the role stores it: the field's stable id and its mode. */
export interface FieldRuleValue {
  readonly fieldId: Id<'Field'>;
  readonly mode: RoleFieldMode;
}

/**
 * The rules of one definition in their stored form: sorted by field id, one per field, at
 * most {@link MAX_FIELD_RULES}, each mode of the closed list. An empty list removes them all.
 */
export function parseFieldRules(
  rules: readonly FieldRuleValue[],
): Result<FieldRuleValue[], InvalidRoleValue> {
  const sorted = [...rules].sort((a, b) => (a.fieldId < b.fieldId ? -1 : 1));
  const distinct = new Set(sorted.map((rule) => rule.fieldId));
  return distinct.size === rules.length &&
    rules.length <= MAX_FIELD_RULES &&
    rules.every((rule) => (ROLE_FIELD_MODES as readonly string[]).includes(rule.mode))
    ? ok(sorted)
    : err({ code: 'identity.value.invalid', field: 'fieldRules' });
}
