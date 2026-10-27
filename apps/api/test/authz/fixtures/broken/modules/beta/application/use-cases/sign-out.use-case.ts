// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/sign-out.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** Valid; the parent of `child.use-case.ts` and the name `wrong-name` copies. */
export class SignOut extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.sign-out',
    rule: { kind: 'own-resources' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
