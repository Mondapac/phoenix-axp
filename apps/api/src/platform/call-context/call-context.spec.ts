import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { err, isMinted, ok } from '@phoenix/shared-kernel';
import type { AuthenticatedActor, TenantContext } from '@phoenix/shared-kernel';
import { systemActor } from '@phoenix/shared-kernel/contexts';
import { testAuthenticatedActor, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS, testAppConfig } from '../../../test/support/test-config';
import type { Authenticator } from '../authz/authenticator';
import { FailClosedAuthenticator } from '../authz/placeholders/fail-closed-authenticator';
import { csrfTokenOf } from '../http/session-cookies';
import { HealthController } from '../health/health.controller';
import { attachTenantContext } from '../tenant-context/attached-tenant-context';
import { ActorGuard } from './actor.guard';
import { callContextOf, MissingCorrelationIdError } from './call-context.decorator';
import { actorOf, attachActor, MissingActorError } from './request-actor';

class ScopedController {}

const CONFIG = testAppConfig({ PANEL_ORIGINS: 'https://studio.example.test' });
const ACCOUNT = '0190f6e2-8b1c-7a00-8000-0000000000a1';
const SESSION = '0190f6e2-8b1c-7a00-8000-0000000000b1';
const TOKEN = 'a'.repeat(43);

/** Accepts {@link TOKEN} only, in the tenant it is asked about, and counts its calls. */
class FakeAuthenticator implements Authenticator {
  calls = 0;
  authenticate(tenant: TenantContext, token: string) {
    this.calls += 1;
    if (token !== TOKEN) return Promise.resolve(err({ code: 'credential.rejected' as const }));
    const actor: AuthenticatedActor = testAuthenticatedActor(tenant, {
      population: 'tenant-staff',
      accountId: ACCOUNT as never,
      sessionId: SESSION as never,
    });
    return Promise.resolve(ok(actor));
  }
}

const guardOf = (authenticator: Authenticator = new FailClosedAuthenticator()) =>
  new ActorGuard(authenticator, CONFIG);

function httpContext(controller: object, request: object): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe.each(TEST_TENANTS)('the call context of a request of %s', (code) => {
  const guard = guardOf();

  function scopedRequest(headers: Record<string, string> = {}, method = 'GET') {
    const request = { headers, method, id: '0190f6e2-8b1c-7a00-8000-000000000001' };
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

  it('attaches the actor of a session the authenticator accepts, in the request tenant', async () => {
    const authenticator = new FakeAuthenticator();
    const request = scopedRequest({ cookie: `theme=dark; __Host-phoenix-studio=${TOKEN}` });

    await expect(
      guardOf(authenticator).canActivate(httpContext(ScopedController, request)),
    ).resolves.toBe(true);
    expect(actorOf(request)).toMatchObject({ kind: 'authenticated', tenantId: code });
    expect(authenticator.calls).toBe(1);
  });

  it('answers 401 session.invalid to a rejected session cookie, never anonymous', async () => {
    const request = scopedRequest({ cookie: `__Host-phoenix-studio=${'b'.repeat(43)}` });

    const refused = guardOf(new FakeAuthenticator()).canActivate(
      httpContext(ScopedController, request),
    );
    await expect(refused).rejects.toMatchObject({
      response: { statusCode: 401, code: 'session.invalid' },
    });
    expect(() => actorOf(request)).toThrow(MissingActorError);
    // The placeholder rejects every session.
    const placeholder = scopedRequest({ cookie: `__Host-phoenix-studio=${TOKEN}` });
    await expect(guard.canActivate(httpContext(ScopedController, placeholder))).rejects.toThrow(
      HttpException,
    );
  });

  it('needs a panel Origin and the CSRF token on a state-changing request', async () => {
    const authenticator = new FakeAuthenticator();
    const csrf = csrfTokenOf(CONFIG.session.secret, TOKEN);
    const cookie = `__Host-phoenix-studio=${TOKEN}`;
    const cases: [Record<string, string>, boolean][] = [
      [{ cookie, origin: 'https://studio.example.test', 'x-csrf-token': csrf }, true],
      [{ cookie, 'x-csrf-token': csrf }, false],
      [{ cookie, origin: 'https://evil.example.test', 'x-csrf-token': csrf }, false],
      [{ cookie, origin: 'https://studio.example.test' }, false],
      [{ cookie, origin: 'https://studio.example.test', 'x-csrf-token': csrf.slice(1) }, false],
      [
        {
          cookie,
          origin: 'https://studio.example.test',
          'x-csrf-token': csrfTokenOf(CONFIG.session.secret, 'c'.repeat(43)),
        },
        false,
      ],
    ];
    for (const [headers, allowed] of cases) {
      const request = scopedRequest(headers, 'POST');
      const decided = guardOf(authenticator).canActivate(httpContext(ScopedController, request));
      if (allowed) await expect(decided).resolves.toBe(true);
      else {
        await expect(decided).rejects.toMatchObject({
          response: { statusCode: 403, code: 'csrf.invalid' },
        });
      }
    }
    // A refused CSRF check never reads the session.
    expect(authenticator.calls).toBe(1);
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
    await expect(guardOf().canActivate(httpContext(HealthController, request))).resolves.toBe(true);
    expect(() => actorOf(request)).toThrow(MissingActorError);
  });
});
