// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/contracts/index.ts.
import { declarePermissions, definePermission } from '../../../../platform';

export const ALPHA_ORDERS_VIEW = definePermission('alpha', {
  key: 'alpha.orders.view',
  scope: 'tenant',
  protected: false,
});

/** A site key: held by tenant staff like a tenant key, so it may share a rule with one. */
export const ALPHA_PAGES_PUBLISH = definePermission('alpha', {
  key: 'alpha.pages.publish',
  scope: 'site',
  protected: false,
});

export const ALPHA_TENANTS_SUSPEND = definePermission('alpha', {
  key: 'alpha.tenants.suspend',
  scope: 'platform',
  protected: true,
});

export const ALPHA_PERMISSIONS = declarePermissions('alpha', [
  ALPHA_ORDERS_VIEW,
  ALPHA_PAGES_PUBLISH,
  ALPHA_TENANTS_SUSPEND,
]);
