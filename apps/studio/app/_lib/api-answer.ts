import type { MessageKey } from '../_i18n/messages';

// What a screen tells the member when the API refuses a change. The API answers
// `{ statusCode, code, field? }` (platform-foundations 5.1); a code the studio has no text for
// reads as the generic failure, and GrantPolicy never says why a grant was refused.

export type ApiAnswer<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly code: string | null };

const BY_CODE: Readonly<Record<string, MessageKey>> = {
  'identity.account.username-taken': 'error.usernameTaken',
  'identity.account.not-found': 'error.notFound',
  'identity.account.not-local': 'error.notLocal',
  'identity.account.own-account': 'error.ownAccount',
  'identity.account.not-linked': 'error.notLinked',
  'identity.account.disabled': 'error.accountDisabled',
  'identity.role.not-found': 'error.notFound',
  'identity.role.key-taken': 'error.roleKeyTaken',
  'identity.role.not-editable': 'error.roleNotEditable',
  'identity.role-assignment.not-found': 'error.notFound',
  'identity.role-assignment.exists': 'error.assignmentExists',
  'identity.site.not-found': 'error.notFound',
  'tenancy.site.not-found': 'error.notFound',
  'tenancy.organization.not-found': 'error.notFound',
  'tenancy.site-domain.not-found': 'error.notFound',
  'tenancy.site.slug-taken': 'error.slugTaken',
  'tenancy.site-domain.taken': 'error.domainTaken',
  'tenancy.tree.depth-exceeded': 'error.depthExceeded',
  'tenancy.tree.move-into-own-subtree': 'error.moveIntoSubtree',
  'forms.form.not-found': 'error.notFound',
  'forms.form-revision.not-found': 'error.notFound',
  'forms.site.not-found': 'error.notFound',
  'forms.submission.not-found': 'error.notFound',
  'forms.form.key-taken': 'error.formKeyTaken',
  'forms.schema.invalid': 'error.schemaInvalid',
  'forms.form-revision.lowering-denied': 'error.loweringDenied',
  'forms.form.not-published': 'error.formNotPublished',
  'forms.form.already-published': 'error.revisionOutdated',
  'forms.form-revision.outdated': 'error.revisionOutdated',
  'forms.form.settings-need-publisher': 'error.settingsNeedPublisher',
  'forms.submission.already-erased': 'error.alreadyErased',
  'role.not-grantable': 'error.notGrantable',
  'member.outranks-actor': 'error.notGrantable',
  'member.self': 'error.self',
  'member.last-holder': 'error.lastHolder',
  'conflict.stale': 'error.stale',
  'conflict.retry': 'error.retry',
  'access.denied': 'error.denied',
  'access.unauthenticated': 'error.signedOut',
  'csrf.invalid': 'error.signedOut',
};

/** The message for a refused change. */
export function failureMessage(answer: {
  readonly status: number;
  readonly code: string | null;
}): MessageKey {
  const known =
    answer.code !== null && Object.hasOwn(BY_CODE, answer.code) ? BY_CODE[answer.code] : undefined;
  if (known !== undefined) return known;
  if (answer.status === 400) return 'error.invalid';
  return 'error.generic';
}
