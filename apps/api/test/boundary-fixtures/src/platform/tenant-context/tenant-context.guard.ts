import type { TenantContextFactory } from './tenant-context.factory';
import { attachTenantContext } from './tenant.decorator';
import { EXEMPTION_KEY } from './no-tenant-context.decorator';

// Allowed: the guard reads the exemption and is the only file that attaches a context.
export function isTenantContextExempt(metadata: { key?: string }): boolean {
  return metadata.key === EXEMPTION_KEY;
}

export class TenantContextGuard {
  constructor(private readonly factory: TenantContextFactory) {}

  canActivate(request: object, tenantId: string): boolean {
    attachTenantContext(request, this.factory.forTenant(tenantId));
    return true;
  }
}
