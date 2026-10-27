import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the identity module (Phoenix ADR-0004 decision 6). Role and grant keys
// arrive with the role use cases (slice 1.6).

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

export const IDENTITY_PERMISSIONS = declarePermissions('identity', [
  IDENTITY_ACCOUNTS_VIEW,
  IDENTITY_ACCOUNTS_MANAGE,
]);
