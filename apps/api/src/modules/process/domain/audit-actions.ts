import { auditField, defineAuditAction } from '@phoenix/shared-kernel';

// Every audited action of the process module (Phoenix ADR-0015 decision 2). Ids and numbers
// only: the process key and the model are the tenant's text and stay out of the audit log.

/** A process revision was published and queued for deployment to the engine (D7). */
export const PROCESS_REVISION_PUBLISHED = defineAuditAction({
  action: 'process.revision.published',
  targetType: 'process.revision',
  actors: ['authenticated'],
  after: { revision: auditField.integer() },
});

export const PROCESS_AUDIT_ACTIONS = [PROCESS_REVISION_PUBLISHED] as const;
