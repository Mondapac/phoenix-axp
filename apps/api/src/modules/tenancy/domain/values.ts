import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// The value rules of the tenancy module. The migration repeats each one as a CHECK, so a row
// that skipped this code is still refused by the database.

/** A site's slug: lower-case ASCII letters and digits joined by single hyphens, 1 to 64. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 64;

/** A display name of a site or an organization, trimmed: 1 to 200 characters. */
export const MAX_NAME_LENGTH = 200;

/** One label of a host name: LDH, 1 to 63, no hyphen at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOSTNAME_LENGTH = 253;

/** A path prefix: "" or "/a/b", each segment a slug. */
const PATH_PREFIX = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const MAX_PATH_PREFIX_LENGTH = 200;

export type InvalidValue = { readonly code: 'tenancy.value.invalid'; readonly field: string };

const invalid = (field: string): Result<never, InvalidValue> =>
  err({ code: 'tenancy.value.invalid', field });

export function parseSlug(value: string): Result<string, InvalidValue> {
  return value.length <= MAX_SLUG_LENGTH && SLUG.test(value) ? ok(value) : invalid('slug');
}

/** Trims; refuses an empty or overlong name and one with control characters. */
export function parseName(value: string): Result<string, InvalidValue> {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || [...name].some(isControl)) {
    return invalid('name');
  }
  return ok(name);
}

const isControl = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

/**
 * A host name in its stored form: lower-cased, at least two labels, ASCII only (an IDN arrives
 * in its punycode form, `xn--...`), no port and no trailing dot.
 */
export function parseHostname(value: string): Result<string, InvalidValue> {
  const hostname = value.toLowerCase();
  const labels = hostname.split('.');
  return hostname.length <= MAX_HOSTNAME_LENGTH &&
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label))
    ? ok(hostname)
    : invalid('hostname');
}

/** "" or "/" mean the whole host and are stored as ""; otherwise "/a/b" with no trailing "/". */
export function parsePathPrefix(value: string): Result<string, InvalidValue> {
  const prefix = value === '/' ? '' : value;
  return prefix.length <= MAX_PATH_PREFIX_LENGTH && PATH_PREFIX.test(prefix)
    ? ok(prefix)
    : invalid('pathPrefix');
}
