import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { SignInSource, TenantSettings } from '../domain/tenant-settings';

/** The tenant's settings row, written on first need with the defaults of the domain. */
export interface TenantSettingsRepository {
  /** The saved settings, or the defaults when the tenant never saved any. */
  read(tenant: TenantContext): Promise<TenantSettings>;
  /**
   * The first statement of every change to a tree's structure: bumps the tenant's structure
   * version, creating the row with the defaults if needed. The row lock it takes serialises
   * structural changes per tenant until the unit ends (PoC 1: concurrent moves), and the
   * statements after it read the trees as the previous change left them. Returns the settings.
   */
  lockStructure(tenant: TenantContext, at: Temporal.Instant): Promise<TenantSettings>;
  /** Throws StaleAggregateError when the saved version is not `expectedVersion`. */
  save(
    tenant: TenantContext,
    expectedVersion: number,
    settings: { readonly signInSources: readonly SignInSource[]; readonly maxSiteDepth: number },
    at: Temporal.Instant,
  ): Promise<void>;
}

export const TENANT_SETTINGS_REPOSITORY = Symbol('TENANT_SETTINGS_REPOSITORY');
