import { isMinted } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';

// The request-to-tenant map lives in this file, which only TenantContextGuard and the
// `@Tenant()` decorator file may import (dependency-cruiser
// `tenant-context-only-through-the-decorator`). Other code reads the tenant through `@Tenant()`
// or `tenantContextOf` from tenant.decorator.ts.

/** A controller asked for the tenant of a request that has none: a programmer error. */
export class MissingTenantContextError extends Error {
  constructor() {
    super(
      'No TenantContext is attached to this request. @Tenant() needs a tenant-scoped ' +
        'controller; an exempt controller has no tenant and gets no default.',
    );
    this.name = 'MissingTenantContextError';
  }
}

// The context of each request, keyed by the request object. Private to this file.
const attached = new WeakMap<object, TenantContext>();

/**
 * Attaches the resolved tenant to a request; called by TenantContextGuard only. Refuses a
 * context the kernel did not mint (a literal, a copy, a value from another copy of the
 * kernel) and a second context on the same request.
 */
export function attachTenantContext(request: object, tenant: TenantContext): void {
  if (!isMinted(tenant)) {
    throw new TypeError('attachTenantContext: the TenantContext was not minted by the kernel');
  }
  if (attached.has(request)) {
    throw new Error('attachTenantContext: this request already has a TenantContext');
  }
  attached.set(request, tenant);
}

/** The tenant attached to a request. Throws when there is none: it never defaults. */
export function tenantContextOf(request: object): TenantContext {
  const tenant = attached.get(request);
  if (tenant === undefined) throw new MissingTenantContextError();
  return tenant;
}
