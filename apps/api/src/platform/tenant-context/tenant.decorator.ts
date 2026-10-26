import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '@phoenix/shared-kernel';
import { tenantContextOf } from './attached-tenant-context';

// Reading only: attaching a request's tenant is TenantContextGuard's, through
// attached-tenant-context.ts (dependency-cruiser `tenant-context-only-through-the-decorator`).
export { tenantContextOf, MissingTenantContextError } from './attached-tenant-context';

/**
 * Parameter decorator: the minted `TenantContext` that TenantContextGuard resolved for this
 * request. It throws when nothing is attached (an exempt controller), so no handler ever runs
 * with a default tenant.
 */
export const Tenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext =>
    tenantContextOf(context.switchToHttp().getRequest<object>()),
);
