import type { Id } from '@phoenix/shared-kernel';
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
  /** `accountId` is for the refusal log only: the HTTP answer carries the code alone. */
  | { readonly code: 'sign-in.account-disabled'; readonly accountId: Id<'Account'> };

export type { InvalidUsername };

export const ACCOUNT_NOT_FOUND: AccountNotFound = Object.freeze({
  code: 'identity.account.not-found',
});

export type RoleNotFound = { readonly code: 'identity.role.not-found' };
export type RoleKeyTaken = { readonly code: 'identity.role.key-taken' };
/** Only a custom role's keys change: a system role holds its scope, a default role is seeded. */
export type RoleNotEditable = { readonly code: 'identity.role.not-editable' };
export type AssignmentNotFound = { readonly code: 'identity.role-assignment.not-found' };
export type AssignmentExists = { readonly code: 'identity.role-assignment.exists' };
/** The site of a site grant, unknown in the tenant. */
export type SiteNotFound = { readonly code: 'identity.site.not-found' };
/**
 * A local account that never signed in holds no role (security review of slice 1.5, M1): it
 * links to the first realm user of its username, who must not inherit grants made before.
 */
export type AccountNotLinked = { readonly code: 'identity.account.not-linked' };

/** A disabled account receives no role (security review of slice 1.6, L1). */
export type AccountDisabled = { readonly code: 'identity.account.disabled' };

export const ROLE_NOT_FOUND: RoleNotFound = Object.freeze({ code: 'identity.role.not-found' });
export const ASSIGNMENT_NOT_FOUND: AssignmentNotFound = Object.freeze({
  code: 'identity.role-assignment.not-found',
});
