import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the tenancy module (Phoenix ADR-0004 decision 6). Tenant scope for now: a
// site-scope key needs the actor's grants to check the site with `grantCoversSite`, and the
// grants arrive with identity (slices 1.5 and 1.6), which may then narrow site management to a
// subtree (ADR-0018 decision 6).

export const TENANCY_SITES_VIEW = definePermission('tenancy', {
  key: 'tenancy.sites.view',
  scope: 'tenant',
  protected: false,
});

/** Create, rename, link, move sites and manage their domains. */
export const TENANCY_SITES_MANAGE = definePermission('tenancy', {
  key: 'tenancy.sites.manage',
  scope: 'tenant',
  protected: false,
});

export const TENANCY_ORGANIZATIONS_VIEW = definePermission('tenancy', {
  key: 'tenancy.organizations.view',
  scope: 'tenant',
  protected: false,
});

export const TENANCY_ORGANIZATIONS_MANAGE = definePermission('tenancy', {
  key: 'tenancy.organizations.manage',
  scope: 'tenant',
  protected: false,
});

export const TENANCY_SETTINGS_VIEW = definePermission('tenancy', {
  key: 'tenancy.settings.view',
  scope: 'tenant',
  protected: false,
});

/** Sign-in sources decide who can enter the tenant: granted only by a system role holder. */
export const TENANCY_SETTINGS_MANAGE = definePermission('tenancy', {
  key: 'tenancy.settings.manage',
  scope: 'tenant',
  protected: true,
});

export const TENANCY_PERMISSIONS = declarePermissions('tenancy', [
  TENANCY_SITES_VIEW,
  TENANCY_SITES_MANAGE,
  TENANCY_ORGANIZATIONS_VIEW,
  TENANCY_ORGANIZATIONS_MANAGE,
  TENANCY_SETTINGS_VIEW,
  TENANCY_SETTINGS_MANAGE,
]);
