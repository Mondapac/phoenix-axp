import type { TenantContext } from '@phoenix/shared-kernel';

// Violations: a module never asserts a value to a context type.
export const violation = [
  { tenantId: 'zz' } as TenantContext,
  <TenantContext>{ tenantId: 'zz' },
  { tenantId: 'zz' } as unknown as Readonly<TenantContext>,
];
