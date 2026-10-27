import { attachTenantContext } from './platform/tenant-context/tenant.decorator';

// Violation: the composition root does not attach a TenantContext either.
export const violation = attachTenantContext;
