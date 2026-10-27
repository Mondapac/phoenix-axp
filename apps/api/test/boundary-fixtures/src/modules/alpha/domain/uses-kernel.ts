import { isMinted } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';

// Allowed: domain/ may import the shared kernel, by its package name.
export function allowed(tenant: TenantContext): boolean {
  return isMinted(tenant);
}
