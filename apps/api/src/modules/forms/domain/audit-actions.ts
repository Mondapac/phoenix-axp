import { auditField, defineAuditAction } from '@phoenix/shared-kernel';
import { AUDIENCES, MAX_POLICY_ROLES } from './form-settings';
import { MAX_FIELDS } from './form-fields';
import { FORM_STATUSES } from './lifecycle';
import { SUBMISSION_CHANNELS } from './submission';

// Every audited action of the forms module (Phoenix ADR-0015 decision 2). Ids, numbers, flags
// and closed codes only: names, keys and the schema documents are free text and stay out of
// the audit log; the revision's content hash identifies the documents.

const settingsFields = {
  audience: auditField.enumOf(AUDIENCES),
  roleIds: auditField.listOf(auditField.id(), MAX_POLICY_ROLES),
  allowOnBehalf: auditField.boolean(),
  /** Absent: keep forever (D5). */
  retentionDays: auditField.optional(auditField.integer()),
};

export const FORM_CREATED = defineAuditAction({
  action: 'forms.form.created',
  targetType: 'forms.form',
  actors: ['authenticated'],
  after: { siteId: auditField.id(), ...settingsFields },
});

export const FORM_UPDATED = defineAuditAction({
  action: 'forms.form.updated',
  targetType: 'forms.form',
  actors: ['authenticated'],
  before: settingsFields,
  after: { ...settingsFields, nameChanged: auditField.boolean() },
});

export const FORM_REVISION_SAVED = defineAuditAction({
  action: 'forms.form-revision.saved',
  targetType: 'forms.form-revision',
  actors: ['authenticated'],
  after: { formId: auditField.id(), number: auditField.integer() },
});

const optionalRevision = auditField.optional(auditField.id());

export const FORM_PUBLISHED = defineAuditAction({
  action: 'forms.form.published',
  targetType: 'forms.form',
  actors: ['authenticated'],
  before: { status: auditField.enumOf(FORM_STATUSES), revisionId: optionalRevision },
  after: { revisionId: auditField.id(), number: auditField.integer() },
});

export const FORM_RETIRED = defineAuditAction({
  action: 'forms.form.retired',
  targetType: 'forms.form',
  actors: ['authenticated'],
  before: { revisionId: auditField.id() },
});

/**
 * A revision saved with fields that were sensitive and are not any more (ADR-0024 decision 3:
 * a change of the `sensitive` flag is its own audited action), under the protected key.
 */
export const FORM_SENSITIVITY_LOWERED = defineAuditAction({
  action: 'forms.form-revision.sensitivity-lowered',
  targetType: 'forms.form-revision',
  actors: ['authenticated'],
  after: { formId: auditField.id(), fieldIds: auditField.listOf(auditField.id(), MAX_FIELDS) },
});

/**
 * A submission received. The bound subject is the submission itself, the subject of its
 * personal data. On behalf of someone else, the audit row's actor is the staff member and the
 * bound subject the person they submitted for (both people, phase 2 review 2.5). No answer
 * reaches the log.
 */
export const FORM_SUBMITTED = defineAuditAction({
  action: 'forms.submission.received',
  targetType: 'forms.submission',
  actors: ['anonymous', 'authenticated'],
  after: {
    formId: auditField.id(),
    revisionId: auditField.id(),
    channel: auditField.enumOf(SUBMISSION_CHANNELS),
    boundSubjectId: auditField.id(),
  },
});

/** The personal data of a submission erased: on request by staff, or by the retention job. */
export const FORM_SUBMISSION_ERASED = defineAuditAction({
  action: 'forms.submission.erased',
  targetType: 'forms.submission',
  actors: ['authenticated', 'system'],
  after: { formId: auditField.id(), reason: auditField.enumOf(['request', 'retention'] as const) },
});

export const FORMS_AUDIT_ACTIONS = [
  FORM_CREATED,
  FORM_UPDATED,
  FORM_REVISION_SAVED,
  FORM_PUBLISHED,
  FORM_RETIRED,
  FORM_SENSITIVITY_LOWERED,
  FORM_SUBMITTED,
  FORM_SUBMISSION_ERASED,
] as const;
