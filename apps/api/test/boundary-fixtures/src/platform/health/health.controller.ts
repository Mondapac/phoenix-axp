import { NoTenantContext } from '../tenant-context/no-tenant-context.decorator';

// Allowed: health is exempt from tenant resolution.
export const exemption = NoTenantContext();
