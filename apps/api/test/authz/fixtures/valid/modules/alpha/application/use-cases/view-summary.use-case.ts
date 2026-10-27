// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/application/use-cases/view-summary.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';
import { ALPHA_ORDERS_VIEW, ALPHA_PAGES_PUBLISH } from '../../contracts';

export class ViewSummary extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'alpha.view-summary',
    rule: { kind: 'permissions', allOf: [ALPHA_ORDERS_VIEW.key, ALPHA_PAGES_PUBLISH.key] },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
