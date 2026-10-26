import { attachTenantContext } from './tenant-context/tenant.decorator';
import * as decorators from './tenant-context/tenant.decorator';

// Violations: only TenantContextGuard attaches a request's TenantContext.
export const violation = [attachTenantContext, decorators.attachTenantContext];
