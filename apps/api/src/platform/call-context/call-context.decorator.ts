import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { parseCorrelationId } from '@phoenix/shared-kernel';
import type { CallContext } from '@phoenix/shared-kernel';
import { createCallContext } from '@phoenix/shared-kernel/contexts';
import { tenantContextOf } from '../tenant-context/tenant.decorator';
import { actorOf } from './request-actor';

/** The request has no valid correlation id: the logger did not run, a programmer error. */
export class MissingCorrelationIdError extends Error {
  override readonly name = 'MissingCorrelationIdError';
  constructor() {
    super('The request has no valid correlation id; the request logger must run first');
  }
}

/**
 * The `CallContext` of the request (ADR-0001): its tenant (from TenantContextGuard), its actor
 * (from ActorGuard) and the correlation id the request logger generated. A controller passes
 * it, unchanged, as the first argument of a use case. It throws when any part is missing, so
 * no handler runs with a default.
 */
export function callContextOf(request: { readonly id?: unknown }): CallContext {
  const correlationId = parseCorrelationId(typeof request.id === 'string' ? request.id : '');
  if (!correlationId.ok) throw new MissingCorrelationIdError();
  return createCallContext(tenantContextOf(request), actorOf(request), correlationId.value);
}

/** Parameter decorator: `handler(@Call() context: CallContext)`. */
export const Call = createParamDecorator((_data: unknown, context: ExecutionContext): CallContext =>
  callContextOf(context.switchToHttp().getRequest<{ id?: unknown }>()),
);
