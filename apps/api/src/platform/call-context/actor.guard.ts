import type { IncomingMessage } from 'node:http';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { anonymousActor } from '@phoenix/shared-kernel/contexts';
import { isTenantContextExempt } from '../tenant-context/tenant-context.guard';
import { tenantContextOf } from '../tenant-context/tenant.decorator';
import { attachActor } from './request-actor';

/** The answer code of a credential this phase cannot check. */
export const SESSION_INVALID = 'session.invalid';

/**
 * Attaches the actor of every tenant-scoped request: the second global guard, after
 * TenantContextGuard, so a request without a tenant never gets this far.
 *
 * Phase 0 has no identity module yet (Keycloak arrives in Phase 1), so every request acts as
 * the anonymous actor of its tenant. A request that carries an `Authorization` header is
 * refused with 401 `session.invalid` rather than served as anonymous: a credential this
 * process cannot check is never ignored (fail closed). The header is never logged.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  readonly #logger = new Logger('ActorGuard');

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      throw new Error('ActorGuard attaches the actor of HTTP requests only');
    }
    if (isTenantContextExempt(context.getClass())) return true;
    const request = context.switchToHttp().getRequest<IncomingMessage & { id?: unknown }>();
    const tenant = tenantContextOf(request);
    if (request.headers.authorization !== undefined) {
      this.#logger.warn({
        msg: 'actor.refused',
        code: SESSION_INVALID,
        reason: 'authorization-header',
        tenantId: tenant.tenantId,
        correlationId: request.id ?? null,
      });
      throw new HttpException({ statusCode: 401, code: SESSION_INVALID }, 401);
    }
    attachActor(request, anonymousActor(tenant));
    return true;
  }
}
