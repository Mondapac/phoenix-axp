// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/undeclared-key.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type PermissionKey,
  type Result,
} from '../../../../../platform';

/** Names a key no `contracts/` declares. */
export class UndeclaredKey extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.undeclared-key',
    rule: { kind: 'permissions', allOf: ['beta.things.unknown' as PermissionKey] },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
