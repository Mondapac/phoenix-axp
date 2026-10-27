import { Tenant } from '../../../platform/tenant-context/tenant.decorator';

// Allowed: a module reads its tenant with @Tenant(), the one import it may make from
// platform/tenant-context/.
export const allowed = Tenant;
