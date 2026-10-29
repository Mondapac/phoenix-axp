// The expected failures of portal sign-in: codes, never values (ADR-0026).

/** The tenant does not offer the method, or cannot deliver it now. */
export type MethodUnavailable = { readonly code: 'portal.method-unavailable' };
/** The message could not be handed to the mail server or SMS provider; try again later. */
export type DeliveryFailed = { readonly code: 'portal.delivery-failed' };
/**
 * A wrong, expired, spent or unknown code, or one sent to another address: one answer for all,
 * so it never says which.
 */
export type CodeInvalid = { readonly code: 'portal.code-invalid' };
/** The account of the address is disabled. */
export type PortalAccountDisabled = { readonly code: 'portal.account-disabled' };
/** Personal data cannot be stored: no subject-key KEK is configured. */
export type PortalUnavailable = { readonly code: 'portal.unavailable' };

export const METHOD_UNAVAILABLE: MethodUnavailable = Object.freeze({
  code: 'portal.method-unavailable',
});
export const CODE_INVALID: CodeInvalid = Object.freeze({ code: 'portal.code-invalid' });
export const PORTAL_UNAVAILABLE: PortalUnavailable = Object.freeze({ code: 'portal.unavailable' });
