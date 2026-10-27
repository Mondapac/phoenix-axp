// Ported from Mondapac apps/api/src/platform/authz/access-denied.ts. Phoenix has no seller, so
// `access.seller-not-approved` is gone; the other codes and statuses are unchanged.

/**
 * A refusal of the gate (Phoenix ADR-0004 decision 4; Mondapac identity design 5.2, "Answers
 * and HTTP status"). Codes, never message text. The same value goes to the caller of
 * `UseCase.execute` and, through the controller, into the error body `{ statusCode, code }`.
 */
export type AccessDenied =
  | { readonly code: 'access.unauthenticated' }
  | { readonly code: 'access.denied' }
  | { readonly code: 'access.unavailable' };

export type AccessDeniedCode = AccessDenied['code'];

/** The HTTP status of each refusal. */
export const ACCESS_DENIED_STATUS: Readonly<Record<AccessDeniedCode, number>> = Object.freeze({
  'access.unauthenticated': 401,
  'access.denied': 403,
  'access.unavailable': 503,
});

export const UNAUTHENTICATED: AccessDenied = Object.freeze({ code: 'access.unauthenticated' });
export const DENIED: AccessDenied = Object.freeze({ code: 'access.denied' });
export const UNAVAILABLE: AccessDenied = Object.freeze({ code: 'access.unavailable' });
