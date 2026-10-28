import type { MessageKey, Messages } from '../_i18n/messages';

// The view of the identity API on the users and roles screens: the shapes the API answers and
// the pure rules that pick what a screen offers. The API decides every action; these only keep
// the screens from offering what it would refuse anyway. Shared by server and client modules.

export interface StaffAccount {
  readonly id: string;
  readonly source: 'local' | 'directory';
  readonly username: string;
  readonly status: 'active' | 'disabled';
  readonly signedInOnce: boolean;
  readonly version: number;
  readonly createdAt: string;
}

export type RoleKind = 'system' | 'default' | 'custom';
export type RoleScope = 'platform' | 'tenant' | 'site';

export interface Role {
  readonly id: string;
  readonly key: string;
  readonly kind: RoleKind;
  readonly scope: RoleScope;
  readonly permissionKeys: readonly string[];
  readonly version: number;
}

export interface PermissionDeclaration {
  readonly key: string;
  readonly scope: RoleScope;
  readonly protected: boolean;
}

export interface RoleAssignment {
  readonly id: string;
  readonly roleId: string;
  readonly roleKey: string;
  readonly level: RoleScope;
  readonly siteId: string | null;
  readonly includeDescendants: boolean;
  readonly createdAt: string;
}

/** The scopes of the permission keys a role of `scope` may confer (platform authz role model). */
export function permissionScopesOfRole(scope: RoleScope): readonly RoleScope[] {
  switch (scope) {
    case 'platform':
      return ['platform'];
    case 'tenant':
      return ['tenant', 'site'];
    case 'site':
      return ['site'];
  }
}

/** The scopes a custom role may have; the system and default roles come from the platform. */
export const CUSTOM_ROLE_SCOPES = ['tenant', 'site'] as const;

/** Kebab case, 2 to 64 characters: the API's rule for a role key, checked before sending. */
export function isRoleKey(text: string): boolean {
  const key = text.trim().toLowerCase();
  return key.length >= 2 && key.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(key);
}

/** The API's username rule, checked before sending. */
export function isUsername(text: string): boolean {
  return /^[a-z0-9][a-z0-9._@-]{0,254}$/.test(text.trim().toLowerCase());
}

export interface PermissionGroup {
  readonly module: string;
  readonly keys: readonly PermissionDeclaration[];
}

/**
 * The catalogue keys a role of `scope` may confer, grouped by module (the first segment of
 * `<module>.<resource>.<action>`), modules and keys in catalogue order.
 */
export function permissionGroups(
  catalogue: readonly PermissionDeclaration[],
  scope: RoleScope,
): PermissionGroup[] {
  const fits = permissionScopesOfRole(scope);
  const groups = new Map<string, PermissionDeclaration[]>();
  for (const declaration of catalogue) {
    if (!fits.includes(declaration.scope)) continue;
    const module = declaration.key.split('.')[0] ?? declaration.key;
    const group = groups.get(module) ?? [];
    group.push(declaration);
    groups.set(module, group);
  }
  return [...groups].map(([module, keys]) => ({ module, keys }));
}

/**
 * Whether the screen offers to disable `account`: an active local account that is not the
 * member's own. Only a local account is disabled here; a directory account follows the
 * directory (ADR-0019).
 */
export function canOfferDisable(account: StaffAccount, ownAccountId: string): boolean {
  return account.source === 'local' && account.status === 'active' && account.id !== ownAccountId;
}

/**
 * Whether the screen offers to grant a role to `account`: the API refuses a grant to a disabled
 * account and to one whose person has not signed in yet (no linked subject).
 */
export function canOfferGrant(account: StaffAccount): boolean {
  return account.status === 'active' && account.signedInOnce;
}

/** The roles a tenant-staff member may grant from the studio: tenant and site roles. */
export function grantableRoles(roles: readonly Role[]): Role[] {
  return roles.filter((role) => role.scope === 'tenant' || role.scope === 'site');
}

/** A text looked up by a key built from data, or `fallback` when the studio has none. */
export function textOr(t: Messages, key: string, fallback: string): string {
  return Object.hasOwn(t, key) ? t[key as MessageKey] : fallback;
}

/** The name of a role: its studio text for a platform-seeded key, else its key. */
export function roleName(t: Messages, key: string): string {
  return textOr(t, `roleName.${key}`, key);
}

/** The reading of a permission key, or the key itself for one the studio has no text for. */
export function permissionLabel(t: Messages, key: string): string {
  return textOr(t, `permission.${key}`, key);
}

/** The reading of a role's kind. */
export function kindLabel(t: Messages, kind: RoleKind): string {
  return t[`kind.${kind}`];
}

/** The reading of a role's or a grant's level. */
export function scopeLabel(t: Messages, scope: RoleScope): string {
  return t[`scope.${scope}`];
}

/** The heading of a module's keys, or the module's name. */
export function moduleLabel(t: Messages, module: string): string {
  return textOr(t, `module.${module}`, module);
}
