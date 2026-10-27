import { auditField, defineAuditAction } from '@phoenix/shared-kernel';
import { ACCOUNT_SOURCES } from './account';
import { CUSTOM_ROLE_SCOPES, GRANT_LEVELS, MAX_ROLE_PERMISSION_KEYS } from './role';
import { SYNC_OUTCOMES } from './directory-sync';

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

/** The directory sync found the person disabled or gone in the directory (ADR-0022 decision 6). */
export const ACCOUNT_DISABLED_BY_DIRECTORY = defineAuditAction({
  action: 'identity.account.disabled-by-directory',
  targetType: 'identity.account',
  actors: ['authenticated', 'system'],
  after: { sessionsEnded: auditField.integer() },
});

/** The directory sync found a person it had disabled enabled again in the directory. */
export const ACCOUNT_ENABLED_BY_DIRECTORY = defineAuditAction({
  action: 'identity.account.enabled-by-directory',
  targetType: 'identity.account',
  actors: ['authenticated', 'system'],
});

const tenantTarget = auditField.enumOf(['tenant'] as const);

/** One row per tenant, so the target is the natural key `tenant`. */
export const DIRECTORY_SYNC_INTERVAL_CHANGED = defineAuditAction({
  action: 'identity.directory-sync.interval-changed',
  targetType: 'identity.directory-sync',
  targetId: tenantTarget,
  actors: ['authenticated'],
  before: { intervalMinutes: auditField.integer() },
  after: { intervalMinutes: auditField.integer() },
});

/** A run that changed accounts, or that stopped without changing any (failed or halted). */
export const DIRECTORY_SYNC_RAN = defineAuditAction({
  action: 'identity.directory-sync.ran',
  targetType: 'identity.directory-sync',
  targetId: tenantTarget,
  actors: ['authenticated', 'system'],
  after: {
    outcome: auditField.enumOf(SYNC_OUTCOMES),
    accountsChecked: auditField.integer(),
    accountsDisabled: auditField.integer(),
    accountsEnabled: auditField.integer(),
  },
});

const permissionKeys = auditField.listOf(auditField.permissionKey(), MAX_ROLE_PERMISSION_KEYS);

/** A custom role defined in studio. Its key is a free string and stays out: the id names it. */
export const ROLE_CREATED = defineAuditAction({
  action: 'identity.role.created',
  targetType: 'identity.role',
  actors: ['authenticated'],
  after: { scope: auditField.enumOf(CUSTOM_ROLE_SCOPES), permissionKeys },
});

export const ROLE_PERMISSIONS_CHANGED = defineAuditAction({
  action: 'identity.role.permissions-changed',
  targetType: 'identity.role',
  actors: ['authenticated'],
  before: { permissionKeys },
  after: { permissionKeys },
});

const grant = {
  accountId: auditField.id(),
  roleId: auditField.id(),
  level: auditField.enumOf(GRANT_LEVELS),
  siteId: auditField.optional(auditField.id()),
  includeDescendants: auditField.boolean(),
};

export const ROLE_ASSIGNED = defineAuditAction({
  action: 'identity.role.assigned',
  targetType: 'identity.role-assignment',
  actors: ['authenticated'],
  after: grant,
});

export const ROLE_REVOKED = defineAuditAction({
  action: 'identity.role.revoked',
  targetType: 'identity.role-assignment',
  actors: ['authenticated'],
  before: grant,
});

export const IDENTITY_AUDIT_ACTIONS = [
  ACCOUNT_PROVISIONED,
  ACCOUNT_CREATED,
  ACCOUNT_LINKED,
  ACCOUNT_DISABLED,
  SESSION_STARTED,
  SESSION_ENDED,
  ACCOUNT_DISABLED_BY_DIRECTORY,
  ACCOUNT_ENABLED_BY_DIRECTORY,
  DIRECTORY_SYNC_INTERVAL_CHANGED,
  DIRECTORY_SYNC_RAN,
  ROLE_CREATED,
  ROLE_PERMISSIONS_CHANGED,
  ROLE_ASSIGNED,
  ROLE_REVOKED,
] as const;
