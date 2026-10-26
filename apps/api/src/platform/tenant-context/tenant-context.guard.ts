import type { IncomingMessage } from 'node:http';
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { attachTenantContext } from './attached-tenant-context';
import { TENANT_CONTEXT_EXEMPTION } from './no-tenant-context.decorator';
import { TenantContextFactory, type TenantContextError } from './tenant-context.factory';
import { TENANT_ID_HEADER } from './tenant-id-header';

/**
 * True when a controller class carries `@NoTenantContext()`. The class's own metadata only:
 * not a method's and not a parent class's. TenantContextGuard and the OpenAPI document both
 * ask this one predicate, so they always agree on which operations need the header.
 */
export function isTenantContextExempt(controller: object): boolean {
  return Reflect.getOwnMetadata(TENANT_CONTEXT_EXEMPTION.KEY, controller) === true;
}

/** The codes of the three answers; the body is `{ statusCode, code }` only. */
type TenantRejection = 'tenant.header-missing' | 'tenant.header-invalid' | 'tenant.not-hosted';

const REJECTION_OF: Record<TenantContextError['code'], TenantRejection> = {
  'tenant-id.invalid': 'tenant.header-invalid',
  'tenant.not-hosted': 'tenant.not-hosted',
};

function reject(code: TenantRejection): BadRequestException {
  // The received value is never echoed and never logged.
  return new BadRequestException({ statusCode: HttpStatus.BAD_REQUEST, code });
}

/**
 * Resolves the tenant of every HTTP request from `x-tenant-id` (ADR-02) and attaches the
 * minted context for `@Tenant()`. It is the first global guard, so a request refused here
 * reaches nothing else and reads nothing from the database. Every controller is
 * tenant-scoped unless its class carries `@NoTenantContext()`.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly factory: TenantContextFactory) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      throw new Error('TenantContextGuard resolves the tenant of HTTP requests only');
    }
    if (isTenantContextExempt(context.getClass())) return true;

    const request = context.switchToHttp().getRequest<IncomingMessage>();
    const header = request.headers[TENANT_ID_HEADER];
    if (header === undefined) throw reject('tenant.header-missing');
    // Node joins a repeated header into one string, which fails the tenant pattern; an
    // array is refused the same way.
    if (typeof header !== 'string') throw reject('tenant.header-invalid');

    const tenant = this.factory.forTenant(header);
    if (!tenant.ok) throw reject(REJECTION_OF[tenant.error.code]);

    attachTenantContext(request, tenant.value);
    return true;
  }
}
