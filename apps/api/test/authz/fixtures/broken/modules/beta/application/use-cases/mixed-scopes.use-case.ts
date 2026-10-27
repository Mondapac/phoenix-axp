// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/mixed-scopes.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';
import { BETA_ORDERS_VIEW, BETA_TENANTS_SUSPEND } from '../../contracts';

/** One tenant key and one platform key in one rule: no population may hold both. */
export class MixedScopes extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.mixed-scopes',
    rule: { kind: 'permissions', allOf: [BETA_ORDERS_VIEW.key, BETA_TENANTS_SUSPEND.key] },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
