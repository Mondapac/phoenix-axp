import { Reflector } from '@nestjs/core';

// Only the guard file and platform/health/ may import this file: the exemption is for health
// and docs only. The guard file re-exports neither the decorator nor its key, only the
// predicate `isTenantContextExempt`.

/** The metadata key of the exemption. Read only by `isTenantContextExempt`. */
export const TENANT_CONTEXT_EXEMPTION = Reflector.createDecorator<void, true>({
  transform: () => true,
});

/**
 * Exempts a whole controller class from tenant resolution. Class-level only: the type
 * refuses a method, and the guard reads the class itself, never a method or a parent class.
 */
export function NoTenantContext(): ClassDecorator {
  return TENANT_CONTEXT_EXEMPTION();
}
