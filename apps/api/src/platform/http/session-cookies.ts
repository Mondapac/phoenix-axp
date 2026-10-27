// The session cookie and the CSRF token of the panels (ADR-0004 decision 2; Mondapac ADR-0018):
// `__Host-` cookies, and a CSRF token that is the HMAC of the session token, so the server stores
// nothing for it and a token is valid for its own session only.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The value of cookie `name` in a `Cookie` header, or null. The first occurrence wins. */
export function cookieValue(header: string | string[] | undefined, name: string): string | null {
  const text = Array.isArray(header) ? header.join('; ') : header;
  if (text === undefined) return null;
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** The CSRF token of a session: HMAC-SHA256 under the session secret, base64url. */
export function csrfTokenOf(secret: Buffer, sessionToken: string): string {
  return createHmac('sha256', secret)
    .update(`csrf\u0000${sessionToken}`, 'utf8')
    .digest('base64url');
}

/** Whether `presented` is the CSRF token of `sessionToken`, in constant time. */
export function csrfTokenMatches(
  secret: Buffer,
  sessionToken: string,
  presented: string | string[] | undefined,
): boolean {
  if (typeof presented !== 'string') return false;
  const expected = Buffer.from(csrfTokenOf(secret, sessionToken), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
