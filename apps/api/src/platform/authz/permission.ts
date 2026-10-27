// Ported from Mondapac apps/api/src/platform/authz/permission.ts (platform-foundations 6.1).
// Phoenix change: the scopes are `platform`, `tenant` and `site` (ADR-0004 decision 7, ADR-0018
// decision 6, ADR-0019) instead of Mondapac's `platform` and `seller`, and each scope names the
// one population that may hold its keys.
import type { Population } from '@phoenix/shared-kernel';
import { PERMISSION_KEY_PATTERN, type PermissionKey } from './access-rule';

/**
 * The longest permission key a module may declare: the bound the role tables of identity will
 * store (Mondapac's `char_length <= 128` CHECK). `definePermission` refuses a longer one at boot.
 */
export const MAX_PERMISSION_KEY_LENGTH = 128;

/** True for a well-formed key no longer than {@link MAX_PERMISSION_KEY_LENGTH}. */
export function isDeclarablePermissionKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length <= MAX_PERMISSION_KEY_LENGTH &&
    PERMISSION_KEY_PATTERN.test(key)
  );
}

/**
 * The scopes of a permission: the narrowest level at which a grant of it makes sense.
 *
 * - `platform`: work of the platform team on the deployment (tenants, operators). Held only
 *   through a platform-scope role, by the `platform-operator` population.
 * - `tenant`: tenant-wide work (tenant settings, roles, staff accounts). Held only through a
 *   tenant-scope role, by `tenant-staff`.
 * - `site`: work on a site's resources (content, forms, panels). Held by `tenant-staff`
 *   through a tenant-scope role (every site of the tenant) or a site-scope role (one site, or
 *   one site and its descendants; ADR-0018 decision 6).
 *
 * There is no portal-user scope: a portal user never holds a staff or operator role
 * (ADR-0019 decision 2); its use cases are `anonymous` or `own-resources`.
 */
export const PERMISSION_SCOPES = ['platform', 'tenant', 'site'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/**
 * The one population that may hold a key of `scope` (ADR-0019: an operator is staff with
 * roles, not a population; `platform-operator` is the platform team only).
 */
export function populationOfScope(scope: PermissionScope): Population {
  return scope === 'platform' ? 'platform-operator' : 'tenant-staff';
}

/**
 * One permission. Declared as a constant in the owning module's `contracts/permissions.ts`
 * through {@link definePermission}; use cases name the constant's `key`. No tenant, no site
 * and no display text: labels are translation keys derived from the key.
 */
export interface PermissionDeclaration {
  readonly key: PermissionKey;
  readonly scope: PermissionScope;
  /** Granted only by the holder of a system role (ADR-0004 decision 7); always written out. */
  readonly protected: boolean;
  /**
   * `definition` for a key over run-time definitions (`objects.record.*`,
   * `forms.submission.*`): a role holds it with a definition qualifier, and the use case checks
   * `grantCoversDefinition` (ADR-0024 decision 2). Absent for every other key.
   */
  readonly qualifier?: PermissionQualifier;
}

/** The closed list of key qualifiers (ADR-0024 decision 2). */
export const PERMISSION_QUALIFIERS = ['definition'] as const;
export type PermissionQualifier = (typeof PERMISSION_QUALIFIERS)[number];

/** Every permission one module declares, as the CI check and the registry read it. */
export interface PermissionCatalogue {
  readonly module: string;
  readonly declarations: readonly PermissionDeclaration[];
}

/** A malformed declaration: a programmer error, refused when the module is loaded. */
export class PermissionDeclarationError extends Error {
  override readonly name = 'PermissionDeclarationError';
}

const catalogues = new WeakSet<object>();

/**
 * The one helper that validates and brands a key: three lower-case segments, the first the
 * declaring module; a scope of the closed list; `protected` written out.
 */
export function definePermission(
  module: string,
  declaration: {
    readonly key: string;
    readonly scope: PermissionScope;
    readonly protected: boolean;
    readonly qualifier?: PermissionQualifier;
  },
): PermissionDeclaration {
  const { key, scope } = declaration;
  if (!isDeclarablePermissionKey(key)) {
    throw new PermissionDeclarationError(
      `Malformed or overlong permission key "${String(key)}" (at most ${MAX_PERMISSION_KEY_LENGTH} characters)`,
    );
  }
  if (key.split('.')[0] !== module) {
    throw new PermissionDeclarationError(`Module "${module}" cannot declare "${key}"`);
  }
  if (!(PERMISSION_SCOPES as readonly unknown[]).includes(scope)) {
    throw new PermissionDeclarationError(`Permission "${key}" has no valid scope`);
  }
  if (typeof declaration.protected !== 'boolean') {
    throw new PermissionDeclarationError(`Permission "${key}" must state protected`);
  }
  const { qualifier } = declaration;
  if (qualifier === undefined) {
    return Object.freeze({ key: key as PermissionKey, scope, protected: declaration.protected });
  }
  if (!(PERMISSION_QUALIFIERS as readonly unknown[]).includes(qualifier)) {
    throw new PermissionDeclarationError(`Permission "${key}" has an unknown qualifier`);
  }
  // Definitions belong to a tenant's sites: a platform key has none to qualify.
  if (scope === 'platform') {
    throw new PermissionDeclarationError(`Platform permission "${key}" cannot be qualified`);
  }
  return Object.freeze({
    key: key as PermissionKey,
    scope,
    protected: declaration.protected,
    qualifier,
  });
}

/**
 * A module's catalogue, exported from its `contracts/permissions.ts` (and re-exported by its
 * `contracts/index.ts`). Refuses a duplicate key and a declaration of another module. The value
 * is recognised by {@link isPermissionCatalogue}, which is how the CI check finds every
 * declared key.
 */
export function declarePermissions(
  module: string,
  declarations: readonly PermissionDeclaration[],
): PermissionCatalogue {
  const keys = new Set<string>();
  for (const declaration of declarations) {
    const checked = definePermission(module, declaration);
    if (keys.has(checked.key)) {
      throw new PermissionDeclarationError(`Permission "${checked.key}" is declared twice`);
    }
    keys.add(checked.key);
  }
  const catalogue = Object.freeze({ module, declarations: Object.freeze([...declarations]) });
  catalogues.add(catalogue);
  return catalogue;
}

/** True only for a value {@link declarePermissions} returned. */
export function isPermissionCatalogue(value: unknown): value is PermissionCatalogue {
  return typeof value === 'object' && value !== null && catalogues.has(value);
}
