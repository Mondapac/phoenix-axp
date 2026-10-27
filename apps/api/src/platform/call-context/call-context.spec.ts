import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { isMinted } from '@phoenix/shared-kernel';
import { systemActor } from '@phoenix/shared-kernel/contexts';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import { HealthController } from '../health/health.controller';
import { attachTenantContext } from '../tenant-context/attached-tenant-context';
import { ActorGuard } from './actor.guard';
import { callContextOf, MissingCorrelationIdError } from './call-context.decorator';
import { actorOf, attachActor, MissingActorError } from './request-actor';

class ScopedController {}

function httpContext(controller: object, request: object): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe.each(TEST_TENANTS)('the call context of a request of %s', (code) => {
  const guard = new ActorGuard();

  function scopedRequest(headers: Record<string, string> = {}) {
    const request = { headers, id: '0190f6e2-8b1c-7a00-8000-000000000001' };
    attachTenantContext(request, testTenantContext(code));
    return request;
  }

  it('attaches the anonymous actor of the tenant', async () => {
    const request = scopedRequest();

    await expect(guard.canActivate(httpContext(ScopedController, request))).resolves.toBe(true);
    const actor = actorOf(request);
    expect(actor).toEqual({ kind: 'anonymous', tenantId: code });
    expect(isMinted(actor)).toBe(true);
  });

  it('refuses a request with an Authorization header: no credential is ignored', async () => {
    const request = scopedRequest({ authorization: 'Bearer something' });

    await expect(guard.canActivate(httpContext(ScopedController, request))).rejects.toThrow(
      HttpException,
    );
    expect(() => actorOf(request)).toThrow(MissingActorError);
  });

  it('builds a minted CallContext from the tenant, the actor and the correlation id', async () => {
    const request = scopedRequest();
    await guard.canActivate(httpContext(ScopedController, request));

    const call = callContextOf(request);
    expect(call.tenant.tenantId).toBe(code);
    expect(call.actor.kind).toBe('anonymous');
    expect(call.correlationId).toBe(request.id);
    expect(isMinted(call)).toBe(true);
  });

  it('throws without a correlation id or an actor; it never defaults', async () => {
    const noActor = scopedRequest();
    expect(() => callContextOf(noActor)).toThrow(MissingActorError);

    const noId: { headers: object; id?: unknown } = { headers: {} };
    attachTenantContext(noId, testTenantContext(code));
    await guard.canActivate(httpContext(ScopedController, noId));
    expect(() => callContextOf(noId)).toThrow(MissingCorrelationIdError);
  });

  it('refuses an actor that was not minted, and a second actor', () => {
    const request = {};
    expect(() => attachActor(request, { kind: 'anonymous', tenantId: code } as never)).toThrow(
      TypeError,
    );
    attachActor(request, systemActor(testTenantContext(code)));
    expect(() => attachActor(request, systemActor(testTenantContext(code)))).toThrow(/already/);
  });
});

describe('ActorGuard on an exempt controller', () => {
  it('attaches nothing and needs no tenant', async () => {
    const request = { headers: {} };
    await expect(
      new ActorGuard().canActivate(httpContext(HealthController, request)),
    ).resolves.toBe(true);
    expect(() => actorOf(request)).toThrow(MissingActorError);
  });
});
