import type { Result, TenantContext } from '@phoenix/shared-kernel';
import type { SignedInIdentity } from '../domain/account';
import type { SignInFlow } from './sign-in-flow';

/** Why the provider gave no identity: down or misconfigured, or it refused the answer. */
export type ProviderFailure = 'provider.unavailable' | 'provider.rejected';

export interface ProviderIdentity extends SignedInIdentity {
  /** The provider's session id (`sid`), for back-channel logout; null when it sent none. */
  readonly idpSessionId: string | null;
}

/**
 * The tenant's staff identity provider (Keycloak, one realm per tenant: ADR-0004 decision 1,
 * owner decision P2). It answers "who are you" only. Calls go over HTTP, so never inside a unit.
 */
export interface StaffIdentityProvider {
  /** The URL that starts an Authorization Code + PKCE sign-in; null when not configured. */
  authorizationUrl(tenant: TenantContext, flow: SignInFlow): string | null;
  /** Exchanges the code and verifies the ID token (signature, issuer, audience, nonce). */
  exchange(
    tenant: TenantContext,
    code: string,
    flow: SignInFlow,
  ): Promise<Result<ProviderIdentity, ProviderFailure>>;
}

export const STAFF_IDENTITY_PROVIDER = Symbol('STAFF_IDENTITY_PROVIDER');

/** How long a staff session lives, in hours (`STAFF_SESSION_HOURS`). */
export const STAFF_SESSION_HOURS = Symbol('STAFF_SESSION_HOURS');
