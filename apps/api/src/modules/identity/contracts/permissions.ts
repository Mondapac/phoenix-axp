import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the identity module (Phoenix ADR-0004 decision 6).

/** See the tenant's staff accounts. */
export const IDENTITY_ACCOUNTS_VIEW = definePermission('identity', {
  key: 'identity.accounts.view',
  scope: 'tenant',
  protected: false,
});

/**
 * Create local staff accounts and disable them. Disabling ends a person's access to the
 * tenant: granted only by a system role holder.
 */
export const IDENTITY_ACCOUNTS_MANAGE = definePermission('identity', {
  key: 'identity.accounts.manage',
  scope: 'tenant',
  protected: true,
});

/** See the tenant's roles, the permission catalogue, and an account's grants. */
export const IDENTITY_ROLES_VIEW = definePermission('identity', {
  key: 'identity.roles.view',
  scope: 'tenant',
  protected: false,
});

/**
 * Create custom roles and change the keys they confer. A role confers only keys its author
 * holds (GrantPolicy); defining what roles mean is granted only by a system role holder.
 */
export const IDENTITY_ROLES_MANAGE = definePermission('identity', {
  key: 'identity.roles.manage',
  scope: 'tenant',
  protected: true,
});

/**
 * Grant roles to staff accounts and revoke them. Site scope: a site grant of a role holding it
 * acts within that site's reach only (ADR-0018 decision 6). Granted only by a system role
 * holder.
 */
export const IDENTITY_ROLE_ASSIGNMENTS_MANAGE = definePermission('identity', {
  key: 'identity.role-assignments.manage',
  scope: 'site',
  protected: true,
});

export const IDENTITY_PERMISSIONS = declarePermissions('identity', [
  IDENTITY_ACCOUNTS_VIEW,
  IDENTITY_ACCOUNTS_MANAGE,
  IDENTITY_ROLES_VIEW,
  IDENTITY_ROLES_MANAGE,
  IDENTITY_ROLE_ASSIGNMENTS_MANAGE,
]);
