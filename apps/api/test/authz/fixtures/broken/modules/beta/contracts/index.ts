// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/contracts/index.ts.
import { declarePermissions, definePermission } from '../../../../platform';

export const BETA_ORDERS_VIEW = definePermission('beta', {
  key: 'beta.orders.view',
  scope: 'tenant',
  protected: false,
});

export const BETA_TENANTS_SUSPEND = definePermission('beta', {
  key: 'beta.tenants.suspend',
  scope: 'platform',
  protected: true,
});

/** On the fixture's retired list: declaring it again is refused. */
export const BETA_THINGS_PURGE = definePermission('beta', {
  key: 'beta.things.purge',
  scope: 'platform',
  protected: false,
});

export const BETA_PERMISSIONS = declarePermissions('beta', [
  BETA_ORDERS_VIEW,
  BETA_TENANTS_SUSPEND,
  BETA_THINGS_PURGE,
]);
