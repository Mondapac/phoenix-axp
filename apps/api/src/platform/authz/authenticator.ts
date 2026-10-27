// SPIKE (PoC 2): the port the ActorGuard calls; identity binds it. Ported from Mondapac.
import type { AuthenticatedActor, Result, TenantContext } from '@phoenix/shared-kernel';

export type CredentialRejected = { readonly code: 'credential.rejected' };

export interface Authenticator {
  /**
   * The actor of a session token presented in the tenant's panel cookie, or a rejection. Reads
   * the session and the account's status from PostgreSQL on every call (no cache).
   */
  authenticate(
    tenant: TenantContext,
    sessionToken: string,
  ): Promise<Result<AuthenticatedActor, CredentialRejected>>;
}

export const AUTHENTICATOR = Symbol('AUTHENTICATOR');

/** The studio panel's session cookie (`__Host-`: Secure, Path=/, no Domain). */
export const STUDIO_SESSION_COOKIE = '__Host-phoenix-studio';
