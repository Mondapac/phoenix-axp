// SPIKE (PoC 2): ported from Mondapac platform/authz, Market -> Tenant, seller states removed.

/** Why the gate refused a call: codes only, never the rule or the keys. */
export type AccessDenied =
  | { readonly code: 'access.unauthenticated' }
  | { readonly code: 'access.denied' }
  | { readonly code: 'access.unavailable' };

export type AccessDeniedCode = AccessDenied['code'];

export const ACCESS_DENIED_STATUS: Readonly<Record<AccessDeniedCode, number>> = Object.freeze({
  'access.unauthenticated': 401,
  'access.denied': 403,
  'access.unavailable': 503,
});

export const UNAUTHENTICATED: AccessDenied = Object.freeze({ code: 'access.unauthenticated' });
export const DENIED: AccessDenied = Object.freeze({ code: 'access.denied' });
export const UNAVAILABLE: AccessDenied = Object.freeze({ code: 'access.unavailable' });
