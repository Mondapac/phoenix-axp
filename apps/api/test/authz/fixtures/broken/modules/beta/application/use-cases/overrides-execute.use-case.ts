// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/overrides-execute.use-case.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../../platform';

/** Replaces the gate's entry. */
export class OverridesExecute extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.overrides-execute',
    rule: { kind: 'system' },
  };

  override execute(context: CallContext): Promise<Result<string, never>> {
    return this.handle(context);
  }

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}
