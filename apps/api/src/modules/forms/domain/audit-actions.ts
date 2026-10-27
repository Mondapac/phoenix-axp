import { auditField, defineAuditAction } from '@phoenix/shared-kernel';
import { AUDIENCES, MAX_POLICY_ROLES } from './form-settings';
import { FORM_STATUSES } from './lifecycle';

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

export const FORMS_AUDIT_ACTIONS = [
  FORM_CREATED,
  FORM_UPDATED,
  FORM_REVISION_SAVED,
  FORM_PUBLISHED,
  FORM_RETIRED,
] as const;
