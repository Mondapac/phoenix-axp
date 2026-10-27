import { err, ok, toAsciiDigits } from '@phoenix/shared-kernel';
import type { Result, Temporal } from '@phoenix/shared-kernel';
import type { Retention, SubmissionPolicy } from './form-settings';

// Form submissions (slice 2.5): who may submit under a form's policy, the tracking code and
// the retention date. Pure.

/** How a submission arrived. `on-behalf`: a staff member submitted it for someone else. */
export const SUBMISSION_CHANNELS = ['anonymous', 'portal-user', 'staff', 'on-behalf'] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];

/** The statuses a submission can have; the process link (slice 2.6) adds the next ones. */
export const SUBMISSION_STATUSES = ['received'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** The most bytes of canonical JSON a submission's answers may take (the HTTP body limit). */
export const MAX_ANSWERS_BYTES = 65_536;

/** Who is submitting for themselves, as far as the policy is concerned. */
export type Submitter =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'portal-user' }
  | { readonly kind: 'staff'; readonly holdsListedRole: boolean }
  /** A platform operator or the system: never a submitter. */
  | { readonly kind: 'other' };

/** The refusal of a submitter the policy does not admit; answered as not found. */
export type NotAdmitted = { readonly code: 'forms.submission.not-admitted' };

/**
 * The channel of a submitter the form's policy admits ("users and ways of submitting a form",
 * section 3): `anyone` admits every person, signed in or not; `portal-user` a signed-in
 * portal user; `staff` any staff member; `staff-roles` a staff member holding one of the
 * listed roles. Submitting on behalf of someone else is decided separately.
 */
export function channelOf(
  policy: SubmissionPolicy,
  submitter: Submitter,
): Result<Exclude<SubmissionChannel, 'on-behalf'>, NotAdmitted> {
  const refused = err({ code: 'forms.submission.not-admitted' } as const);
  if (submitter.kind === 'other') return refused;
  switch (policy.audience) {
    case 'anyone':
      return ok(submitter.kind);
    case 'portal-user':
      return submitter.kind === 'portal-user' ? ok('portal-user') : refused;
    case 'staff':
      return submitter.kind === 'staff' ? ok('staff') : refused;
    case 'staff-roles':
      return submitter.kind === 'staff' && submitter.holdsListedRole ? ok('staff') : refused;
  }
}

/** When the personal data of a submission made `at` is to be erased; null keeps it (D5). */
export function eraseAfterOf(retention: Retention, at: Temporal.Instant): Temporal.Instant | null {
  return retention.kind === 'fixed' ? at.add({ hours: 24 * retention.days }) : null;
}

/**
 * The tracking code: 16 random decimal digits (about 53 bits), shown as four groups of four.
 * Digits only, so a person can read it out or type it on any keyboard; with the rate limit on
 * the tracking page, guessing one is not practical.
 */
export const TRACKING_CODE_DIGITS = 16;

/** `1234-5678-9012-3456` from 16 digits. */
export function formatTrackingCode(digits: string): string {
  return digits.match(/\d{4}/g)?.join('-') ?? digits;
}

/**
 * The 16 digits of a typed tracking code: Persian and Arabic-Indic digits become ASCII, and
 * spaces, hyphens and invisible joiners are dropped. Null for anything else.
 */
export function parseTrackingCode(input: string): string | null {
  if (input.length > 64) return null;
  const digits = toAsciiDigits(input).replace(/[\s-]|‌|‍|[‎‏]/g, '');
  return new RegExp(`^\\d{${TRACKING_CODE_DIGITS}}$`).test(digits) ? digits : null;
}
