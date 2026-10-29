import { addressNetwork, type RateLimitRule } from '../../../platform/rate-limit';

export { addressNetwork };

// The rate limits of the forms module's public routes (team defaults, not owner decisions).
// The subject is the account of a signed-in person, else the client address.

/** Submitting any form: 10 per 10 minutes. */
export const SUBMIT_LIMIT: RateLimitRule = Object.freeze({
  name: 'forms.submit',
  limit: 10,
  windowSeconds: 600,
});

/** Asking for a CAPTCHA challenge: 30 per 10 minutes. */
export const CHALLENGE_LIMIT: RateLimitRule = Object.freeze({
  name: 'forms.challenge',
  limit: 30,
  windowSeconds: 600,
});

/** Looking up a tracking code: 30 per 10 minutes. */
export const TRACK_LIMIT: RateLimitRule = Object.freeze({
  name: 'forms.track',
  limit: 30,
  windowSeconds: 600,
});

/** The rate-limit subject of a request: the account when signed in, else the network. */
export function limitSubject(
  actor: { readonly kind: string; readonly accountId?: string },
  clientAddress: string,
): string {
  return actor.kind === 'authenticated' && actor.accountId !== undefined
    ? `account:${actor.accountId}`
    : `address:${addressNetwork(clientAddress)}`;
}

/** The CAPTCHA purpose of a form submission. */
export const SUBMIT_CAPTCHA_PURPOSE = 'forms.submit';
