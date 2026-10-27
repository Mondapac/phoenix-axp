// SPIKE (PoC 2): what identity needs of the IdP (Keycloak): "who are you" and nothing about
// roles or permissions (ADR-0004 decision 1).
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import type { SignInFlow } from '../sign-in-flow';

export interface ProviderIdentity {
  /** The IdP's stable subject of the person in the tenant's realm. */
  readonly subject: string;
  readonly username: string;
  /** The IdP's session (`sid`), for back-channel logout. */
  readonly idpSessionId: string | null;
}

export interface LogoutNotice {
  readonly subject: string | null;
  readonly idpSessionId: string | null;
}

export type ProviderFailure = 'provider.rejected' | 'provider.unavailable';

export interface StaffIdentityProvider {
  authorizationUrl(tenant: TenantContext, flow: SignInFlow): string;
  exchange(
    tenant: TenantContext,
    code: string,
    flow: SignInFlow,
  ): Promise<Result<ProviderIdentity, ProviderFailure>>;
  /** OIDC Back-Channel Logout 1.0: the verified claims of a logout token. */
  verifyLogoutToken(
    tenant: TenantContext,
    token: string,
  ): Promise<Result<LogoutNotice, ProviderFailure>>;
}

export const STAFF_IDENTITY_PROVIDER = Symbol('STAFF_IDENTITY_PROVIDER');

/** The IdP's view of one account, read through its admin API. */
export interface IdpAccount {
  readonly exists: boolean;
  readonly enabled: boolean;
  /** True when the account comes from the directory (federated LDAP/AD). */
  readonly directory: boolean;
}

export interface StaffDirectoryAdmin {
  account(tenant: TenantContext, subject: string): Promise<Result<IdpAccount, 'idp.unavailable'>>;
  /** Disables a local account in the IdP and ends its IdP sessions. */
  disableLocal(tenant: TenantContext, subject: string): Promise<Result<void, 'idp.unavailable'>>;
}

export const STAFF_DIRECTORY_ADMIN = Symbol('STAFF_DIRECTORY_ADMIN');
