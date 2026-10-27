// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/wrong-name.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** Declares the name of `sign-out.use-case.ts`: not its file stem, and a duplicate. */
export class WrongName extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.sign-out',
    rule: { kind: 'own-resources' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
