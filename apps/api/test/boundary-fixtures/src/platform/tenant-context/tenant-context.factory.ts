import { mintTenantContext } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';

// Allowed: the platform factory is the one place that mints a TenantContext.
export class TenantContextFactory {
  forTenant(tenantId: string): TenantContext {
    return mintTenantContext(tenantId);
  }
}
