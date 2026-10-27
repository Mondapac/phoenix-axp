import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { SignInFailure } from '../failures';
import type { SignInFlows } from '../sign-in-flow';
import type { StaffIdentityProvider } from '../staff-identity-provider';

export interface BeganSignIn {
  /** Where the browser goes next: the tenant's Keycloak realm. */
  readonly authorizationUrl: string;
  /** Kept by the browser in the flow cookie until the callback; never stored here. */
  readonly flowSecret: string;
}

/**
 * Starts a staff sign-in by OIDC Authorization Code + PKCE (ADR-0004 decision 1). `anonymous`:
 * the visitor has no session yet. Nothing is stored: state, nonce and verifier are derived
 * from the flow secret at the callback.
 */
export class BeginStaffSignIn extends UseCase<
  void,
  BeganSignIn,
  Extract<SignInFailure, { code: 'sign-in.unavailable' }>
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.begin-staff-sign-in',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly flows: SignInFlows,
    private readonly provider: StaffIdentityProvider,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
  ): Promise<Result<BeganSignIn, Extract<SignInFailure, { code: 'sign-in.unavailable' }>>> {
    const flowSecret = this.flows.issue();
    const flow = this.flows.derive(flowSecret, context.tenant);
    const authorizationUrl =
      flow === null ? null : this.provider.authorizationUrl(context.tenant, flow);
    if (authorizationUrl === null) {
      return Promise.resolve(err({ code: 'sign-in.unavailable' } as const));
    }
    return Promise.resolve(ok({ authorizationUrl, flowSecret }));
  }
}
