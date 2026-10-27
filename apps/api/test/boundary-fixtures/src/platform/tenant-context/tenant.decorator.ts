import type { TenantContext } from '@phoenix/shared-kernel';

const attached = new WeakMap<object, TenantContext>();

export function attachTenantContext(request: object, tenant: TenantContext): void {
  attached.set(request, tenant);
}

export function tenantContextOf(request: object): TenantContext | undefined {
  return attached.get(request);
}

export function Tenant(): ParameterDecorator {
  return () => undefined;
}
