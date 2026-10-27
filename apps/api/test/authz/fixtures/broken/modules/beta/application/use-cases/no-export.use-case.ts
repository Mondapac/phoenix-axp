// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/no-export.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** A use case the file does not export. */
class Hidden extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.no-export',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}

export const HIDDEN_NAME = Hidden.name;
