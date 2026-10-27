import { NoTenantContext } from '../../../platform/tenant-context/no-tenant-context.decorator';

// Violation: only health and docs are exempt from tenant resolution.
export const violation = NoTenantContext();
