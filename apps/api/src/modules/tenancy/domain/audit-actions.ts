import { auditField, defineAuditAction } from '@phoenix/shared-kernel';
import { SIGN_IN_SOURCES } from './tenant-settings';

// Every audited action of the tenancy module (Phoenix ADR-0015 decision 2). Ids, depths and
// flags only: names, slugs and host names are free text and stay out of the audit log.

const parentId = auditField.optional(auditField.id());

export const SITE_CREATED = defineAuditAction({
  action: 'tenancy.site.created',
  targetType: 'tenancy.site',
  actors: ['authenticated'],
  after: { parentSiteId: parentId, organizationId: parentId, depth: auditField.integer() },
});

export const SITE_UPDATED = defineAuditAction({
  action: 'tenancy.site.updated',
  targetType: 'tenancy.site',
  actors: ['authenticated'],
  before: { organizationId: parentId },
  after: { organizationId: parentId, nameChanged: auditField.boolean() },
});

/** A move recomputes every subtree grant from the new tree (ADR-0018 decision 6). */
export const SITE_MOVED = defineAuditAction({
  action: 'tenancy.site.moved',
  targetType: 'tenancy.site',
  actors: ['authenticated'],
  before: { parentSiteId: parentId, depth: auditField.integer() },
  after: {
    parentSiteId: parentId,
    depth: auditField.integer(),
    subtreeSize: auditField.integer(),
  },
});

export const SITE_DOMAIN_ADDED = defineAuditAction({
  action: 'tenancy.site-domain.added',
  targetType: 'tenancy.site-domain',
  actors: ['authenticated'],
  after: { siteId: auditField.id() },
});

export const SITE_DOMAIN_REMOVED = defineAuditAction({
  action: 'tenancy.site-domain.removed',
  targetType: 'tenancy.site-domain',
  actors: ['authenticated'],
  before: { siteId: auditField.id() },
});

export const ORGANIZATION_CREATED = defineAuditAction({
  action: 'tenancy.organization.created',
  targetType: 'tenancy.organization',
  actors: ['authenticated'],
  after: { parentId, depth: auditField.integer() },
});

export const ORGANIZATION_RENAMED = defineAuditAction({
  action: 'tenancy.organization.renamed',
  targetType: 'tenancy.organization',
  actors: ['authenticated'],
});

export const ORGANIZATION_MOVED = defineAuditAction({
  action: 'tenancy.organization.moved',
  targetType: 'tenancy.organization',
  actors: ['authenticated'],
  before: { parentId, depth: auditField.integer() },
  after: { parentId, depth: auditField.integer(), subtreeSize: auditField.integer() },
});

const settingsFields = {
  signInSources: auditField.listOf(auditField.enumOf(SIGN_IN_SOURCES), SIGN_IN_SOURCES.length),
  maxSiteDepth: auditField.integer(),
};

/** One row per tenant, so the target is the natural key `tenant`. */
export const TENANT_SETTINGS_CHANGED = defineAuditAction({
  action: 'tenancy.tenant-settings.changed',
  targetType: 'tenancy.tenant-settings',
  targetId: auditField.enumOf(['tenant'] as const),
  actors: ['authenticated'],
  before: settingsFields,
  after: settingsFields,
});

export const TENANCY_AUDIT_ACTIONS = [
  SITE_CREATED,
  SITE_UPDATED,
  SITE_MOVED,
  SITE_DOMAIN_ADDED,
  SITE_DOMAIN_REMOVED,
  ORGANIZATION_CREATED,
  ORGANIZATION_RENAMED,
  ORGANIZATION_MOVED,
  TENANT_SETTINGS_CHANGED,
] as const;
