import type { RateLimitRule } from '../../../../platform/rate-limit';

// The rate limits of portal sign-in (ADR-0026 decision 3; team defaults, not owner decisions).

/** Asking for a CAPTCHA challenge: 30 per 10 minutes per client network. */
export const PORTAL_CHALLENGE_LIMIT: RateLimitRule = Object.freeze({
  name: 'identity.portal-challenge',
  limit: 30,
  windowSeconds: 600,
});

/** Codes sent to one address: 5 per hour. */
export const CODES_PER_ADDRESS: RateLimitRule = Object.freeze({
  name: 'identity.portal-code-address',
  limit: 5,
  windowSeconds: 3600,
});

/** Codes asked by one client network: 20 per hour. */
export const CODES_PER_CLIENT: RateLimitRule = Object.freeze({
  name: 'identity.portal-code-client',
  limit: 20,
  windowSeconds: 3600,
});

/** Codes sent by one tenant and method: 2000 per hour, a ceiling on what abuse can spend. */
export const CODES_PER_TENANT: RateLimitRule = Object.freeze({
  name: 'identity.portal-code-tenant',
  limit: 2000,
  windowSeconds: 3600,
});

/**
 * Answers tried from one client network: 120 per hour. Not per address: a limit keyed on the
 * address would let anyone who knows it lock its owner out. A code's own cap
 * (MAX_CODE_FAILURES) and the codes per address bound the guesses on one address.
 */
export const ANSWERS_PER_CLIENT: RateLimitRule = Object.freeze({
  name: 'identity.portal-answer-client',
  limit: 120,
  windowSeconds: 3600,
});

/** The CAPTCHA purpose of asking for a code. */
export const PORTAL_CODE_CAPTCHA_PURPOSE = 'identity.portal-code';

/** The blind-index purpose of a portal address. */
export const PORTAL_ADDRESS_INDEX = 'identity.portal-address';
