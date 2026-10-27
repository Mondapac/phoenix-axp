import { Injectable } from '@nestjs/common';
import { err, mintTenantContext, ok, parseTenantId } from '@phoenix/shared-kernel';
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import { TenantRegistry } from '../tenant-config/tenant-registry';

/** Why a tenant id gave no context. A closed union with stable codes and no input text. */
export type TenantContextError =
  { readonly code: 'tenant-id.invalid' } | { readonly code: 'tenant.not-hosted' };

/**
 * The only production constructor of a `TenantContext` (ADR-0002): it parses the id, asks the
 * registry whether this deployment hosts the tenant, and mints the context. It never
 * substitutes a tenant and has no default or fallback.
 *
 * Every entry adapter (HTTP request, scheduled job, consumed event) goes through it. Modules
 * never call it: they receive the context from their entry adapter.
 */
@Injectable()
export class TenantContextFactory {
  constructor(private readonly registry: TenantRegistry) {}

  forTenant(code: string): Result<TenantContext, TenantContextError> {
    const tenantId = parseTenantId(code);
    if (!tenantId.ok) return err({ code: 'tenant-id.invalid' });
    if (!this.registry.isHosted(tenantId.value)) return err({ code: 'tenant.not-hosted' });
    return ok(mintTenantContext(tenantId.value));
  }
}
