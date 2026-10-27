import { isIPv6 } from 'node:net';
import type { RateLimitRule } from '../../../platform/rate-limit';

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

/**
 * The network an address counts under: an IPv6 address by its /64 (one host usually holds a
 * whole /64, so counting single addresses would give it endless buckets; security review L7),
 * an IPv4 address (also when mapped into IPv6) as it is.
 */
export function addressNetwork(address: string): string {
  if (!isIPv6(address)) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped !== null) return mapped[1]!;
  const [head = '', tail = ''] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  // A trailing dotted IPv4 part (`64:ff9b::1.2.3.4`) takes two groups.
  const width = (parts: string[]): number =>
    parts.length + (parts.at(-1)?.includes('.') === true ? 1 : 0);
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}

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
