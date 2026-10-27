import { ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { invalid, type InvalidValue } from './values';

// A form's own settings: who may submit it (the submission policy, "users and ways of
// submitting a form", section 3) and how long the personal data of its submissions is kept
// (owner decision D5 of the phase 2 review). The submission use case (slice 2.5) enforces
// both; this slice stores and validates them.

/**
 * Who may submit: anyone without signing in (a tracking code follows), a signed-in portal
 * user, any signed-in staff member, or staff holding one of the listed roles.
 */
export const AUDIENCES = ['anyone', 'portal-user', 'staff', 'staff-roles'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** The most roles a `staff-roles` policy may list. */
export const MAX_POLICY_ROLES = 32;

export interface SubmissionPolicy {
  readonly audience: Audience;
  /** Non-empty exactly for `staff-roles`, without repeats; empty otherwise. */
  readonly roleIds: readonly Id<'Role'>[];
  /** Staff holding the submit-on-behalf permission may submit for someone else. */
  readonly allowOnBehalf: boolean;
}

export function parseSubmissionPolicy(input: {
  readonly audience: string;
  readonly roleIds: readonly Id<'Role'>[];
  readonly allowOnBehalf: boolean;
}): Result<SubmissionPolicy, InvalidValue> {
  if (!(AUDIENCES as readonly string[]).includes(input.audience)) return invalid('audience');
  const audience = input.audience as Audience;
  const roleIds = [...new Set(input.roleIds)];
  if (roleIds.length !== input.roleIds.length) return invalid('roleIds');
  if (audience === 'staff-roles') {
    if (roleIds.length === 0 || roleIds.length > MAX_POLICY_ROLES) return invalid('roleIds');
  } else if (roleIds.length > 0) {
    return invalid('roleIds');
  }
  return ok({ audience, roleIds, allowOnBehalf: input.allowOnBehalf });
}

/** The longest fixed retention, in days (100 years). */
export const MAX_RETENTION_DAYS = 36_500;

/**
 * How long the personal data of a submission is kept (D5): forever, or a fixed number of days
 * after which its subject key is destroyed. Erasure on request is possible under both.
 */
export type Retention =
  { readonly kind: 'forever' } | { readonly kind: 'fixed'; readonly days: number };

/** D5: "keep forever" unless the form's manager chooses a fixed period. */
export const DEFAULT_RETENTION: Retention = Object.freeze({ kind: 'forever' });

export function parseRetention(input: {
  readonly kind: string;
  readonly days?: number;
}): Result<Retention, InvalidValue> {
  if (input.kind === 'forever') {
    return input.days === undefined ? ok(DEFAULT_RETENTION) : invalid('retention.days');
  }
  if (input.kind !== 'fixed') return invalid('retention.kind');
  const { days } = input;
  return days !== undefined && Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS
    ? ok({ kind: 'fixed', days })
    : invalid('retention.days');
}

/** The stored form: null for forever. */
export const retentionDaysOf = (retention: Retention): number | null =>
  retention.kind === 'fixed' ? retention.days : null;

export const retentionOf = (days: number | null): Retention =>
  days === null ? DEFAULT_RETENTION : { kind: 'fixed', days };

/** Whether two settings are the same (role order aside). */
export function sameSettings(
  a: { readonly policy: SubmissionPolicy; readonly retention: Retention },
  b: { readonly policy: SubmissionPolicy; readonly retention: Retention },
): boolean {
  const roles = new Set(a.policy.roleIds);
  return (
    a.policy.audience === b.policy.audience &&
    a.policy.allowOnBehalf === b.policy.allowOnBehalf &&
    a.policy.roleIds.length === b.policy.roleIds.length &&
    b.policy.roleIds.every((id) => roles.has(id)) &&
    retentionDaysOf(a.retention) === retentionDaysOf(b.retention)
  );
}
