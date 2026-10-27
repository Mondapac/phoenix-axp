// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/unlisted-anonymous.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** A non-permission rule missing from the checked-in list. */
export class UnlistedAnonymous extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.unlisted-anonymous',
    rule: { kind: 'anonymous' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
