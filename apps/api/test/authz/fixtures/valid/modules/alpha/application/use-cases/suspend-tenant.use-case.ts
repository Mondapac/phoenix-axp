// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/application/use-cases/approve-seller.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';
import { ALPHA_TENANTS_SUSPEND } from '../../contracts';

export class SuspendTenant extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'alpha.suspend-tenant',
    rule: { kind: 'permissions', allOf: [ALPHA_TENANTS_SUSPEND.key] },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
