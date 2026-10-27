// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/application/use-cases/sign-in.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

export class SignIn extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'alpha.sign-in',
    rule: { kind: 'anonymous' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
