// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/listed-as-deny.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** Says `own-resources` in code while the list records `system`. */
export class ListedAsSystem extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.listed-as-system',
    rule: { kind: 'own-resources' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
