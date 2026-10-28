import { auditField, defineAuditAction } from '@phoenix/shared-kernel';
import { MAX_FIELDS } from './fields';
import { DEFINITION_STATUSES } from './lifecycle';

// Every audited action of the objects module (Phoenix ADR-0015 decision 2). Ids, numbers, flags
// and closed codes only: names, keys, labels and record values are free text or personal data
// and stay out of the audit log; a record change names the ids of the fields it changed.

const fieldIds = auditField.listOf(auditField.id(), MAX_FIELDS);

export const DEFINITION_CREATED = defineAuditAction({
  action: 'objects.definition.created',
  targetType: 'objects.definition',
  actors: ['authenticated'],
  after: { siteId: auditField.id() },
});

export const DEFINITION_RENAMED = defineAuditAction({
  action: 'objects.definition.renamed',
  targetType: 'objects.definition',
  actors: ['authenticated'],
});

export const REVISION_SAVED = defineAuditAction({
  action: 'objects.revision.saved',
  targetType: 'objects.revision',
  actors: ['authenticated'],
  after: { definitionId: auditField.id(), number: auditField.integer() },
});

/**
 * A revision saved with fields that were sensitive and are not any more (ADR-0024 decision 3),
 * under the protected key.
 */
export const REVISION_SENSITIVITY_LOWERED = defineAuditAction({
  action: 'objects.revision.sensitivity-lowered',
  targetType: 'objects.revision',
  actors: ['authenticated'],
  after: { definitionId: auditField.id(), fieldIds },
});

export const DEFINITION_PUBLISHED = defineAuditAction({
  action: 'objects.definition.published',
  targetType: 'objects.definition',
  actors: ['authenticated'],
  before: {
    status: auditField.enumOf(DEFINITION_STATUSES),
    revisionId: auditField.optional(auditField.id()),
  },
  after: { revisionId: auditField.id(), number: auditField.integer() },
});

export const DEFINITION_RETIRED = defineAuditAction({
  action: 'objects.definition.retired',
  targetType: 'objects.definition',
  actors: ['authenticated'],
  before: { revisionId: auditField.id() },
});

export const RECORD_CREATED = defineAuditAction({
  action: 'objects.record.created',
  targetType: 'objects.record',
  actors: ['authenticated'],
  after: {
    definitionId: auditField.id(),
    revisionId: auditField.id(),
    siteId: auditField.id(),
    fieldIds,
  },
});

export const RECORD_UPDATED = defineAuditAction({
  action: 'objects.record.updated',
  targetType: 'objects.record',
  actors: ['authenticated'],
  before: { revisionId: auditField.id() },
  after: { revisionId: auditField.id(), fieldIds },
});

/**
 * The record's values split again under the published revision's `sensitive` marks by the
 * `objects.seal-records` job: a field marked sensitive since the record was written is sealed.
 */
export const RECORD_RESEALED = defineAuditAction({
  action: 'objects.record.resealed',
  targetType: 'objects.record',
  actors: ['system'],
  before: { revisionId: auditField.id() },
  after: { revisionId: auditField.id() },
});

/** The record removed and its subject key destroyed: its sealed values cannot be opened. */
export const RECORD_DELETED = defineAuditAction({
  action: 'objects.record.deleted',
  targetType: 'objects.record',
  actors: ['authenticated'],
  before: { definitionId: auditField.id(), siteId: auditField.id() },
});

export const OBJECTS_AUDIT_ACTIONS = [
  DEFINITION_CREATED,
  DEFINITION_RENAMED,
  REVISION_SAVED,
  REVISION_SENSITIVITY_LOWERED,
  DEFINITION_PUBLISHED,
  DEFINITION_RETIRED,
  RECORD_CREATED,
  RECORD_UPDATED,
  RECORD_RESEALED,
  RECORD_DELETED,
] as const;
