import { systemActor } from '@phoenix/shared-kernel/contexts';

// Allowed: a platform entry adapter (here the scheduler) builds the system actor of a tenant.
export const allowed = systemActor({ tenantId: 'zz' });
