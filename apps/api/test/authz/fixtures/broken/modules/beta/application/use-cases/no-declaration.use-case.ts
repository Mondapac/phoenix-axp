// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/no-declaration.use-case.ts.
import { ok, UseCase, type CallContext, type Result } from '../../../../../platform';

/** No declaration of its own. */
export class NoDeclaration extends UseCase<void, string> {
  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
