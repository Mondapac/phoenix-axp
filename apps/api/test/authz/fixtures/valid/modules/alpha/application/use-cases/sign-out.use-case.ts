// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/application/use-cases/sign-out.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

export class SignOut extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'alpha.sign-out',
    rule: { kind: 'own-resources' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
