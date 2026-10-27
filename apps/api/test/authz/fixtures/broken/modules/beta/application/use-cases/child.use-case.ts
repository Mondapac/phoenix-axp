// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/use-cases/child.use-case.ts.
import type { AccessDeclaration } from '../../../../../platform';
import { SignOut } from './sign-out.use-case';

/** Extends another use case (HF4): refused even with its own declaration. */
export class Child extends SignOut {
  static override readonly access: AccessDeclaration = {
    name: 'beta.child',
    rule: { kind: 'system' },
  };
}
