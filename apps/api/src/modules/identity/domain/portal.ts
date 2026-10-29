import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// Portal sign-in with one-time codes (ADR-0026; owner decision P1): the methods a tenant
// offers, the addresses a portal user signs in with, and the rules of a code. Pure.

/** The source of every portal account: its credential is a one-time code. */
export const PORTAL_ACCOUNT_SOURCE = 'one-time-code';

/** How a portal user receives a code (owner decision P1). */
export const PORTAL_METHODS = ['email', 'mobile'] as const;
export type PortalMethod = (typeof PORTAL_METHODS)[number];

/** A code is six digits, lives five minutes and survives five wrong answers (ADR-0026). */
export const CODE_DIGITS = 6;
export const CODE_TTL_SECONDS = 300;
export const MAX_CODE_FAILURES = 5;

export type InvalidPortalValue = {
  readonly code: 'identity.value.invalid';
  readonly field: 'address' | 'methods' | 'countryCallingCode';
};
const invalid = (field: InvalidPortalValue['field']): Result<never, InvalidPortalValue> =>
  err({ code: 'identity.value.invalid', field });

/** The portal sign-in settings of a tenant. */
export interface PortalSignInSettings {
  readonly methods: readonly PortalMethod[];
  /** Digits, without "+"; null accepts international numbers only. */
  readonly countryCallingCode: string | null;
  /** 0 before the tenant saved any setting. */
  readonly version: number;
}

/** A tenant that never saved its settings offers no method: sign-in is closed. */
export const CLOSED_PORTAL: PortalSignInSettings = Object.freeze({
  methods: Object.freeze([]),
  countryCallingCode: null,
  version: 0,
});

/** The methods, each once, in the catalogue's order. */
export function parseMethods(
  values: readonly string[],
): Result<PortalMethod[], InvalidPortalValue> {
  if (values.length > PORTAL_METHODS.length || new Set(values).size !== values.length) {
    return invalid('methods');
  }
  if (!values.every((value) => (PORTAL_METHODS as readonly string[]).includes(value))) {
    return invalid('methods');
  }
  return ok(PORTAL_METHODS.filter((method) => values.includes(method)));
}

/** An ITU country calling code: one to four digits, not starting with 0. */
export function parseCountryCallingCode(
  value: string | null,
): Result<string | null, InvalidPortalValue> {
  if (value === null) return ok(null);
  const digits = asciiDigits(value.trim()).replace(/^\+/, '');
  return /^[1-9][0-9]{0,3}$/.test(digits) ? ok(digits) : invalid('countryCallingCode');
}

/** Persian (U+06F0..) and Arabic-Indic (U+0660..) digits as ASCII; the rest unchanged. */
export function asciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** Mailbox `local@domain.tld`, ASCII, at most 254 characters, stored in lower case. */
const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;

/**
 * The address of `method` in its stored form: an email in lower case, or a mobile number in
 * E.164 (`+` and 8 to 15 digits). A national number (leading 0) takes the tenant's country
 * calling code; spaces, hyphens and parentheses are dropped, Persian and Arabic digits read.
 */
export function parseAddress(
  method: PortalMethod,
  value: string,
  countryCallingCode: string | null,
): Result<string, InvalidPortalValue> {
  if (value.length > 320) return invalid('address');
  if (method === 'email') {
    const email = value.trim().toLowerCase();
    return email.length <= 254 && EMAIL.test(email) && !email.includes('..')
      ? ok(email)
      : invalid('address');
  }
  let number = asciiDigits(value).replace(/[\s\-().‌]/g, '');
  if (number.startsWith('00')) number = `+${number.slice(2)}`;
  if (!number.startsWith('+')) {
    if (countryCallingCode === null || !number.startsWith('0')) return invalid('address');
    number = `+${countryCallingCode}${number.slice(1)}`;
  }
  return /^\+[1-9][0-9]{7,14}$/.test(number) ? ok(number) : invalid('address');
}

/** What the account page shows of an address: enough to recognise it, not to copy it. */
export function maskAddress(method: PortalMethod, address: string): string {
  if (method === 'email') {
    const at = address.lastIndexOf('@');
    const local = address.slice(0, at);
    return `${local.slice(0, Math.min(2, local.length - 1))}***${address.slice(at)}`;
  }
  return `${address.slice(0, 4)}***${address.slice(-3)}`;
}
