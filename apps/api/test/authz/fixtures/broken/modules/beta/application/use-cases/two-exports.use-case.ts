// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/two-exports.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** Two use cases in one file. */
export class TwoExportsFirst extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.two-exports',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}

export class TwoExportsSecond extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.two-exports',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
