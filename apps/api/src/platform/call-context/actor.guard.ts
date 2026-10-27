import type { IncomingMessage } from 'node:http';
import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { anonymousActor } from '@phoenix/shared-kernel/contexts';
import { isTenantContextExempt } from '../tenant-context/tenant-context.guard';
import { tenantContextOf } from '../tenant-context/tenant.decorator';
import { AUTHENTICATOR, STUDIO_SESSION_COOKIE, type Authenticator } from '../authz/authenticator';
import { attachActor } from './request-actor';

/** One cookie of the request's Cookie header, or undefined (no cookie-parser dependency). */
export function cookieOf(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

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

  // SPIKE (PoC 2): identity binds the Authenticator; a request with the studio session cookie
  // is authenticated on every request from PostgreSQL (no cache), or refused with 401.
  constructor(@Optional() @Inject(AUTHENTICATOR) private readonly authenticator?: Authenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    const token = cookieOf(request, STUDIO_SESSION_COOKIE);
    if (token !== undefined) {
      const actor =
        this.authenticator === undefined
          ? null
          : await this.authenticator.authenticate(tenant, token);
      if (actor === null || !actor.ok) {
        this.#logger.warn({
          msg: 'actor.refused',
          code: SESSION_INVALID,
          reason: 'session',
          tenantId: tenant.tenantId,
          correlationId: request.id ?? null,
        });
        throw new HttpException({ statusCode: 401, code: SESSION_INVALID }, 401);
      }
      attachActor(request, actor.value);
      return true;
    }
    attachActor(request, anonymousActor(tenant));
    return true;
  }
}
