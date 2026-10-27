// Phoenix ADR-0004 decision 2 (Mondapac identity design 5.1): the port the ActorGuard asks for
// the actor of a session. Ported from the PoC 2 spike (platform/authz/authenticator.ts).
import type { AuthenticatedActor, Result, TenantContext } from '@phoenix/shared-kernel';

/** Any refusal of a credential: one code, so an answer never tells why. */
export type CredentialRejected = { readonly code: 'credential.rejected' };

/**
 * The actor of a session token presented in a panel's session cookie, or a rejection. The
 * identity module implements it (`SessionAuthenticator`, the one file that mints authenticated
 * actors). It reads the session and the account's status from committed state on every call, in
 * a read-only unit of its own, and caches nothing: an ended session or a disabled account is
 * refused on the next request. A session is looked up in `tenant` only (the tenant the request
 * named), so a session of another tenant is not found (security review S2-3).
 *
 * Until identity binds it, `AuthzModule` binds the fail-closed placeholder of
 * `placeholders/fail-closed-authenticator.ts`: every credential is rejected.
 */
export interface Authenticator {
  authenticate(
    tenant: TenantContext,
    sessionToken: string,
  ): Promise<Result<AuthenticatedActor, CredentialRejected>>;
}

/** Nest token of the {@link Authenticator}. */
export const AUTHENTICATOR = Symbol('AUTHENTICATOR');

/**
 * The studio panel's session cookie (tenant staff). `__Host-`: Secure, Path=/, no Domain; the
 * studio BFF forwards it. The admin and portal panels get their own cookies with their sign-in.
 */
export const STUDIO_SESSION_COOKIE = '__Host-phoenix-studio';

/** The header that carries the CSRF token of a state-changing request with a session. */
export const CSRF_HEADER = 'x-csrf-token';
