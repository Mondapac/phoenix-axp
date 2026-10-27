// Ported from Mondapac apps/api/src/platform/authz/authorisation-check.ts (platform-foundations
// 6.3, identity design 5.2). Phoenix change: no seller states; the population check moved into
// the gate (it needs only the registry), so the port decides "holds every key" alone.
import type { CallContext } from '@phoenix/shared-kernel';
import type { AccessDenied } from './access-denied';
import type { AccessDeclaration } from './access-rule';

/** The answer of {@link AuthorisationCheck}: allowed, or one refusal with its code. */
export type AccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly denial: Exclude<AccessDenied, { readonly code: 'access.unauthenticated' }>;
    };

/**
 * The port the identity module implements (Phase 1, after PoC 2). The gate calls it only for an
 * authenticated actor under a `permissions` or `own-resources` rule, after it has checked that
 * every key is declared and of a scope the actor's population may hold. It reads committed
 * state on every call, in a read-only unit of its own and never inside the caller's, and
 * caches nothing (ADR-0004 decision 2): the account is active, and every key is held through
 * one of the actor's role assignments in its tenant.
 *
 * A key held only through a site-scope grant is held "somewhere in the tenant": the gate does
 * not know the resource. The use case then checks that the grant covers the resource's site
 * with `grantCoversSite` (site-scope.ts) from the actor's grants, never from input (ADR-0004
 * decision 5).
 *
 * Until identity binds it, `AuthzModule` binds the fail-closed placeholder of
 * `placeholders/fail-closed-authorisation-check.ts`: every authenticated actor is refused with
 * `access.unavailable`.
 */
export interface AuthorisationCheck {
  check(context: CallContext, declaration: AccessDeclaration): Promise<AccessDecision>;
}

/** Nest token of the {@link AuthorisationCheck}. */
export const AUTHORISATION_CHECK = Symbol('AUTHORISATION_CHECK');
