// SPIKE (PoC 2): the port identity binds; ported from Mondapac.
import type { CallContext } from '@phoenix/shared-kernel';
import type { AccessDenied } from './access-denied';
import type { AccessDeclaration } from './access-rule';

export type AccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly denial: Exclude<AccessDenied, { readonly code: 'access.unauthenticated' }>;
    };

/**
 * Identity's answer for an authenticated actor under `permissions` or `own-resources`. Reads
 * committed state on every call: no session or permission cache (ADR-0004 decision 2).
 */
export interface AuthorisationCheck {
  check(context: CallContext, declaration: AccessDeclaration): Promise<AccessDecision>;
}

export const AUTHORISATION_CHECK = Symbol('AUTHORISATION_CHECK');
