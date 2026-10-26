import { mintTenantContext } from '@phoenix/shared-kernel';
import * as kernel from '@phoenix/shared-kernel';
import { TenantContextFactory } from '../../../platform/tenant-context/tenant-context.factory';

// Violations: a module mints no context, whatever the import form, and uses no factory.
export const violation = [
  mintTenantContext('zz'),
  kernel.mintTenantContext('zz'),
  new TenantContextFactory().forTenant('zz'),
];
