// The role model types of Phoenix ADR-0004 decision 7, amended by ADR-0018 decision 6 and
// ADR-0019. Adapted from Mondapac apps/api/src/modules/identity/domain/role.ts (ROLE_SCOPES,
// ROLE_KINDS, scopeOfPopulation): Phoenix keeps the types and the pure policies in platform/authz
// until the identity module, which will own the Role and RoleAssignment aggregates, their tables
// and their events, exists (after PoC 2). Pure: no Nest, no Prisma, no I/O.
import type { Id, Population } from '@phoenix/shared-kernel';
import type { PermissionScope } from '../permission';

/**
 * The scope of a role (ADR-0004 decision 7): `platform` for the platform team, `tenant` for
 * tenant-wide staff roles, `site` for roles granted on one site (and optionally its subtree).
 * Organisation scoping is not modelled yet: it waits for the Organization tree of the tenancy
 * module (ADR-0018 decision 3 keeps the two trees separate).
 */
export const ROLE_SCOPES = ['platform', 'tenant', 'site'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/** `system` (holds every key of its scope by definition), `default` (versioned seed), `custom`. */
export const ROLE_KINDS = ['system', 'default', 'custom'] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

/**
 * Where one role assignment applies (ADR-0018 decision 6). A site-scope grant is either
 * `thisSite` (`includeDescendants: false`) or the site and every site below it
 * (`includeDescendants: true`). Access flows only downward, never up or sideways.
 */
export type GrantScope =
  | { readonly level: 'platform' }
  | { readonly level: 'tenant' }
  | {
      readonly level: 'site';
      readonly siteId: Id<'Site'>;
      readonly includeDescendants: boolean;
    };

/**
 * The population that may hold a role of `scope` (ADR-0019): platform roles are the platform
 * team's; tenant and site roles are staff roles. A portal user holds no role at all.
 */
export function populationOfRoleScope(scope: RoleScope): Population {
  return scope === 'platform' ? 'platform-operator' : 'tenant-staff';
}

/** The role scopes a population may hold: none for a portal user (ADR-0019 decision 2). */
export function roleScopesOf(population: Population): readonly RoleScope[] {
  switch (population) {
    case 'platform-operator':
      return ['platform'];
    case 'tenant-staff':
      return ['tenant', 'site'];
    case 'portal-user':
      return [];
  }
}

/**
 * The permission scopes a role of `scope` may hold: a platform role holds platform keys; a
 * tenant role holds tenant and site keys (its site keys apply to every site of the tenant); a
 * site role holds site keys only.
 */
export function permissionScopesOfRole(scope: RoleScope): readonly PermissionScope[] {
  switch (scope) {
    case 'platform':
      return ['platform'];
    case 'tenant':
      return ['tenant', 'site'];
    case 'site':
      return ['site'];
  }
}

/** True when a grant of `scope` sits at the level a role of `roleScope` is granted at. */
export function grantFitsRole(scope: GrantScope, roleScope: RoleScope): boolean {
  return scope.level === roleScope;
}
