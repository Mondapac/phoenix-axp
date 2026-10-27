// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/application/use-cases/purge-expired.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

export class PurgeExpired extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'alpha.purge-expired',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
