// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/bad-declaration.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** A rule kind outside the closed set (cast: the check must refuse it at run time too). */
export class BadDeclaration extends UseCase<void, string> {
  static override readonly access = {
    name: 'beta.bad-declaration',
    rule: { kind: 'everyone' },
  } as unknown as AccessDeclaration;

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
