import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Population, Result } from '@phoenix/shared-kernel';

// The staff account (ADR-0019): one per employee and tenant. Keycloak holds the credentials and
// the directory link; the core holds the account's status, roles and sessions. Pure.

/** Where an account comes from (ADR-0019 decision 3). */
export const ACCOUNT_SOURCES = ['directory', 'local'] as const;
export type AccountSource = (typeof ACCOUNT_SOURCES)[number];

export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface Account {
  readonly id: Id<'Account'>;
  readonly population: Population;
  readonly source: AccountSource;
  /** The identity provider's subject; null for a local account before its first sign-in. */
  readonly subject: string | null;
  readonly username: string;
  readonly status: AccountStatus;
  readonly version: number;
}

export type InvalidUsername = {
  readonly code: 'identity.value.invalid';
  readonly field: 'username';
};

const INVALID_USERNAME: InvalidUsername = Object.freeze({
  code: 'identity.value.invalid',
  field: 'username',
});

/**
 * A sign-in name as Keycloak and AD use them: ASCII letters, digits and `. _ - @`, starting
 * with a letter or digit, at most 255 characters. Compared in lower case, as Keycloak does.
 */
const USERNAME = /^[a-z0-9][a-z0-9._@-]{0,254}$/;

/** The username in its stored form (trimmed, lower case), or the field's failure. */
export function parseUsername(value: string): Result<string, InvalidUsername> {
  const username = value.trim().toLowerCase();
  return USERNAME.test(username) ? ok(username) : err(INVALID_USERNAME);
}

/** What the identity provider says about the person who signed in. */
export interface SignedInIdentity {
  readonly subject: string;
  readonly username: string;
  /** A directory (LDAP/AD) user federated by Keycloak; otherwise a local user of the realm. */
  readonly directory: boolean;
}

/**
 * How a sign-in maps to an account (ADR-0019 decision 3), from the account with the identity's
 * subject (`bySubject`) and the account with its username (`byUsername`):
 *
 * - a known subject signs in to its account, if the account's source is the identity's;
 * - a directory user without an account gets one, with no roles, unless the username is taken;
 * - a local user without an account must have been created in studio: the local account of
 *   the same username that has never signed in is linked to the subject;
 * - anything else is refused.
 */
export type SignInMatch =
  | { readonly kind: 'existing'; readonly account: Account }
  | { readonly kind: 'link-local'; readonly account: Account }
  | { readonly kind: 'create-directory' }
  | { readonly kind: 'refused'; readonly reason: 'no-account' | 'source-mismatch' };

export function matchSignIn(
  identity: SignedInIdentity,
  bySubject: Account | null,
  byUsername: Account | null,
): SignInMatch {
  const source: AccountSource = identity.directory ? 'directory' : 'local';
  if (bySubject !== null) {
    return bySubject.source === source
      ? { kind: 'existing', account: bySubject }
      : { kind: 'refused', reason: 'source-mismatch' };
  }
  if (identity.directory) {
    return byUsername === null
      ? { kind: 'create-directory' }
      : { kind: 'refused', reason: 'source-mismatch' };
  }
  if (byUsername !== null && byUsername.source === 'local' && byUsername.subject === null) {
    return { kind: 'link-local', account: byUsername };
  }
  return { kind: 'refused', reason: 'no-account' };
}
