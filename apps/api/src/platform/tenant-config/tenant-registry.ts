import type { TenantId } from '@phoenix/shared-kernel';
import type { TenantConfig } from './tenant-config';

/**
 * Thrown by `get()` for a tenant this deployment does not host. For configuration-time
 * callers; a request, job or event is refused through `TenantContextFactory` instead.
 */
export class TenantNotHostedError extends Error {
  constructor(readonly tenantId: TenantId) {
    super(`Tenant "${tenantId}" is not hosted by this deployment`);
    this.name = 'TenantNotHostedError';
  }
}

/**
 * The tenants this deployment serves (ADR-02). There is no default tenant: callers always
 * name the tenant, and a tenant outside HOSTED_TENANTS is refused.
 *
 * It takes parsed tenant ids and mints nothing: `TenantContextFactory` is the only
 * constructor of a `TenantContext`.
 */
export class TenantRegistry {
  constructor(private readonly tenants: ReadonlyMap<TenantId, TenantConfig>) {}

  /** Ids of all hosted tenants, in HOSTED_TENANTS order. */
  hostedTenantIds(): readonly TenantId[] {
    return [...this.tenants.keys()];
  }

  isHosted(tenantId: TenantId): boolean {
    return this.tenants.has(tenantId);
  }

  /** @throws TenantNotHostedError when the tenant is not hosted here. */
  get(tenantId: TenantId): TenantConfig {
    const tenant = this.tenants.get(tenantId);
    if (tenant === undefined) throw new TenantNotHostedError(tenantId);
    return tenant;
  }
}
