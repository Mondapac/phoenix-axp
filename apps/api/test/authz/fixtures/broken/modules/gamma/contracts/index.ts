// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/gamma/contracts/index.ts.
import { declarePermissions, definePermission } from '../../../../platform';

/** A catalogue in `gamma/` that declares another module's keys. */
export const DELTA_PERMISSIONS = declarePermissions('delta', [
  definePermission('delta', { key: 'delta.things.view', scope: 'platform', protected: false }),
]);
