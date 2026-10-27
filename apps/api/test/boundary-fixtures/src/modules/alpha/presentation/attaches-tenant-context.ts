import { attachTenantContext } from '../../../platform/tenant-context/tenant.decorator';

// Violation: only TenantContextGuard attaches a request's TenantContext.
export const violation = attachTenantContext;
