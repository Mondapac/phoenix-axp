import { auditField, defineAuditAction } from '@phoenix/shared-kernel';

// Every audited action of the process module (Phoenix ADR-0015 decision 2). Ids and numbers
// only: the process key and the model are the tenant's text and stay out of the audit log, and
// so do outcome codes, which the model names.

/** A process revision was published and queued for deployment to the engine (D7). */
export const PROCESS_REVISION_PUBLISHED = defineAuditAction({
  action: 'process.revision.published',
  targetType: 'process.revision',
  actors: ['authenticated'],
  after: { revision: auditField.integer() },
});

/** A decision table revision was published and queued for deployment to the engine (2.7). */
export const PROCESS_DECISION_PUBLISHED = defineAuditAction({
  action: 'process.decision.published',
  targetType: 'process.decision',
  actors: ['authenticated'],
  after: { revision: auditField.integer() },
});

/** A staff member took a task from its queue (ADR-0025, owner decision D3). */
export const PROCESS_TASK_CLAIMED = defineAuditAction({
  action: 'process.task.claimed',
  targetType: 'process.task',
  actors: ['authenticated'],
});

/** The holder gave a claimed task back to its queue. */
export const PROCESS_TASK_RELEASED = defineAuditAction({
  action: 'process.task.released',
  targetType: 'process.task',
  actors: ['authenticated'],
});

/** A supervisor gave a task to a staff member. */
export const PROCESS_TASK_ASSIGNED = defineAuditAction({
  action: 'process.task.assigned',
  targetType: 'process.task',
  actors: ['authenticated'],
  after: { assignee: auditField.id() },
});

/** The holder decided a task; the engine completes it through the relay. */
export const PROCESS_TASK_COMPLETION_REQUESTED = defineAuditAction({
  action: 'process.task.completion-requested',
  targetType: 'process.task',
  actors: ['authenticated'],
});

/** The deadline passed: the task moved to its escalation role's queue. */
export const PROCESS_TASK_ESCALATED = defineAuditAction({
  action: 'process.task.escalated',
  targetType: 'process.task',
  actors: ['system'],
  after: { role: auditField.id() },
});

/**
 * A decision that had not reached the engine when the deadline passed: the deadline won and the
 * decision is labelled superseded (owner decision on PoC 3 R7); the task escalated instead.
 */
export const PROCESS_TASK_COMPLETION_SUPERSEDED = defineAuditAction({
  action: 'process.task.completion-superseded',
  targetType: 'process.task',
  actors: ['system'],
  after: { role: auditField.id() },
});

/** The tenant's working calendar was replaced (D4): how many weekend days and holidays. */
export const PROCESS_CALENDAR_CHANGED = defineAuditAction({
  action: 'process.calendar.changed',
  targetType: 'process.calendar',
  targetId: auditField.enumOf(['tenant'] as const),
  actors: ['authenticated'],
  after: { weekendDays: auditField.integer(), holidays: auditField.integer() },
});

export const PROCESS_AUDIT_ACTIONS = [
  PROCESS_REVISION_PUBLISHED,
  PROCESS_DECISION_PUBLISHED,
  PROCESS_TASK_CLAIMED,
  PROCESS_TASK_RELEASED,
  PROCESS_TASK_ASSIGNED,
  PROCESS_TASK_COMPLETION_REQUESTED,
  PROCESS_TASK_ESCALATED,
  PROCESS_TASK_COMPLETION_SUPERSEDED,
  PROCESS_CALENDAR_CHANGED,
] as const;
