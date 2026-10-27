import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { Subtree } from './site.repository';

export interface OrganizationRecord {
  readonly id: Id<'Organization'>;
  readonly parentId: Id<'Organization'> | null;
  readonly name: string;
  readonly depth: number;
  readonly version: number;
}

/**
 * The organization tree of one tenant (ADR-0018 decision 3), the same shape as the site tree.
 * Structural writes run after `TenantSettingsRepository.lockStructure` in the same unit.
 */
export interface OrganizationRepository {
  find(tenant: TenantContext, id: Id<'Organization'>): Promise<OrganizationRecord | null>;
  /** Every node of the tenant, by depth then name. */
  list(tenant: TenantContext): Promise<OrganizationRecord[]>;
  insert(
    tenant: TenantContext,
    organization: Omit<OrganizationRecord, 'version'>,
    at: Temporal.Instant,
  ): Promise<void>;
  /** Throws StaleAggregateError on another version. */
  rename(
    tenant: TenantContext,
    id: Id<'Organization'>,
    expectedVersion: number,
    name: string,
    at: Temporal.Instant,
  ): Promise<void>;
  subtree(tenant: TenantContext, id: Id<'Organization'>): Promise<Subtree<'Organization'>>;
  move(
    tenant: TenantContext,
    subtree: Subtree<'Organization'>,
    newParentId: Id<'Organization'> | null,
    depthShift: number,
    at: Temporal.Instant,
  ): Promise<void>;
}

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
