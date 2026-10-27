// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/sneaky.ts.
import {
  ok,
  UseCase,
  type AccessDeclaration,
  type CallContext,
  type Result,
} from '../../../../platform';

/** Subclasses of `UseCase` outside the glob: by name, through an alias, and anonymous. */
export class Sneaky extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.sneaky',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}

const Base = UseCase;

export class Aliased extends Base<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.aliased',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
}

const anonymous = class extends UseCase<void, string> {
  static override readonly access: AccessDeclaration = {
    name: 'beta.anonymous',
    rule: { kind: 'system' },
  };

  protected handle(context: CallContext): Promise<Result<string, never>> {
    return Promise.resolve(ok(context.tenant.tenantId));
  }
};

export const ANONYMOUS_NAME = anonymous.name;
