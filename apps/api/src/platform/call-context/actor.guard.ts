import type { IncomingMessage } from 'node:http';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { anonymousActor } from '@phoenix/shared-kernel/contexts';
import type { TenantContext } from '@phoenix/shared-kernel';
import {
  AUTHENTICATOR,
  CSRF_HEADER,
  STUDIO_SESSION_COOKIE,
  type Authenticator,
} from '../authz/authenticator';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { cookieValue, csrfTokenMatches } from '../http/session-cookies';
import { isTenantContextExempt } from '../tenant-context/tenant-context.guard';
import { tenantContextOf } from '../tenant-context/tenant.decorator';
import { attachActor } from './request-actor';

/** The answer code of a credential that is not a live session of the request's tenant. */
export const SESSION_INVALID = 'session.invalid';
/** The answer code of a state-changing request with a session but no valid Origin or token. */
export const CSRF_INVALID = 'csrf.invalid';

/** Methods that change nothing (RFC 9110 9.2.1): they need no CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type Refusal = 'authorization-header' | 'session-rejected' | 'origin' | 'csrf-token';

/**
 * Attaches the actor of every tenant-scoped request: the second global guard, after
 * TenantContextGuard, so a request without a tenant never gets this far.
 *
 * Without a session cookie the request acts as the anonymous actor of its tenant. With the
 * studio session cookie, identity's {@link Authenticator} decides the actor on every request (no
 * cache); a cookie it rejects answers 401 `session.invalid` rather than anonymous, and the BFF
 * drops the cookie. A state-changing request with a session must come from a panel origin
 * (`Origin` in `PANEL_ORIGINS`) and carry the session's CSRF token, or it answers 403
 * `csrf.invalid` before the session is read (ADR-0004 decision 2).
 *
 * An `Authorization` header is refused with 401 `session.invalid`: the platform accepts no
 * bearer credential, and a credential this process cannot check is never ignored. Neither the
 * header, the cookie nor the token is ever logged.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  readonly #logger = new Logger('ActorGuard');

  constructor(
    @Inject(AUTHENTICATOR) private readonly authenticator: Authenticator,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      throw new Error('ActorGuard attaches the actor of HTTP requests only');
    }
    if (isTenantContextExempt(context.getClass())) return true;
    const request = context.switchToHttp().getRequest<IncomingMessage & { id?: unknown }>();
    const tenant = tenantContextOf(request);
    if (request.headers.authorization !== undefined) {
      return this.refuse(request, tenant, 'authorization-header');
    }
    const token = cookieValue(request.headers.cookie, STUDIO_SESSION_COOKIE);
    if (token === null || token === '') {
      attachActor(request, anonymousActor(tenant));
      return true;
    }
    if (!SAFE_METHODS.has(request.method ?? '')) {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !this.config.session.panelOrigins.includes(origin)) {
        return this.refuse(request, tenant, 'origin');
      }
      if (!csrfTokenMatches(this.config.session.secret, token, request.headers[CSRF_HEADER])) {
        return this.refuse(request, tenant, 'csrf-token');
      }
    }
    const actor = await this.authenticator.authenticate(tenant, token);
    if (!actor.ok) return this.refuse(request, tenant, 'session-rejected');
    attachActor(request, actor.value);
    return true;
  }

  private refuse(
    request: IncomingMessage & { id?: unknown },
    tenant: TenantContext,
    reason: Refusal,
  ): never {
    const csrf = reason === 'origin' || reason === 'csrf-token';
    const code = csrf ? CSRF_INVALID : SESSION_INVALID;
    const statusCode = csrf ? 403 : 401;
    this.#logger.warn({
      msg: 'actor.refused',
      code,
      reason,
      tenantId: tenant.tenantId,
      correlationId: request.id ?? null,
    });
    throw new HttpException({ statusCode, code }, statusCode);
  }
}
