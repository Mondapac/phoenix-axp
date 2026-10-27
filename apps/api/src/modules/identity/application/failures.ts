import type { InvalidUsername } from '../domain/account';

// The expected failures of the identity use cases: codes, never values. The controllers map each
// code to its HTTP status.

export type AccountNotFound = { readonly code: 'identity.account.not-found' };
export type UsernameTaken = { readonly code: 'identity.account.username-taken' };
/** A directory account's source of truth is the directory: the sync disables it, not studio. */
export type AccountNotLocal = { readonly code: 'identity.account.not-local' };
/** Nobody disables their own account: it would lock them out mid-request. */
export type OwnAccount = { readonly code: 'identity.account.own-account' };

export type SignInFailure =
  | { readonly code: 'sign-in.flow-invalid' }
  | { readonly code: 'sign-in.rejected' }
  | { readonly code: 'sign-in.unavailable' }
  | { readonly code: 'sign-in.no-staff-account' }
  | { readonly code: 'sign-in.account-disabled' };

export type { InvalidUsername };

export const ACCOUNT_NOT_FOUND: AccountNotFound = Object.freeze({
  code: 'identity.account.not-found',
});
