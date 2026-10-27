import { auditField, defineAuditAction } from '@phoenix/shared-kernel';
import { ACCOUNT_SOURCES } from './account';

// Every audited action of the identity module (Phoenix ADR-0015 decision 2). Ids, sources and
// counts only: usernames and subjects are personal data and stay out of the audit log.

const boundSubjectId = auditField.id();

/** A directory user's first sign-in created its account (no roles). */
export const ACCOUNT_PROVISIONED = defineAuditAction({
  action: 'identity.account.provisioned',
  targetType: 'identity.account',
  actors: ['anonymous'],
  after: { boundSubjectId, source: auditField.enumOf(ACCOUNT_SOURCES) },
});

/** A local staff account created in studio, before its first sign-in. */
export const ACCOUNT_CREATED = defineAuditAction({
  action: 'identity.account.created',
  targetType: 'identity.account',
  actors: ['authenticated'],
  after: { source: auditField.enumOf(ACCOUNT_SOURCES) },
});

/** A local account's first sign-in linked it to its identity-provider subject. */
export const ACCOUNT_LINKED = defineAuditAction({
  action: 'identity.account.linked',
  targetType: 'identity.account',
  actors: ['anonymous'],
  after: { boundSubjectId },
});

export const ACCOUNT_DISABLED = defineAuditAction({
  action: 'identity.account.disabled',
  targetType: 'identity.account',
  actors: ['authenticated'],
  after: { sessionsEnded: auditField.integer() },
});

export const SESSION_STARTED = defineAuditAction({
  action: 'identity.session.started',
  targetType: 'identity.session',
  actors: ['anonymous'],
  after: { boundSubjectId },
});

export const SESSION_ENDED = defineAuditAction({
  action: 'identity.session.ended',
  targetType: 'identity.session',
  actors: ['authenticated'],
});

export const IDENTITY_AUDIT_ACTIONS = [
  ACCOUNT_PROVISIONED,
  ACCOUNT_CREATED,
  ACCOUNT_LINKED,
  ACCOUNT_DISABLED,
  SESSION_STARTED,
  SESSION_ENDED,
] as const;
