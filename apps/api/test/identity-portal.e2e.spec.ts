import { Controller, Get, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { err, ok, Temporal } from '@phoenix/shared-kernel';
import type { CallContext, Population, TenantContext } from '@phoenix/shared-kernel';
import { testAuthenticatedActor } from '@phoenix/shared-kernel/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AUTHENTICATOR, type Authenticator } from '../src/platform/authz/authenticator';
import { APP_CONFIG } from '../src/platform/config/config.module';
import type { AppConfig } from '../src/platform/config/app-config';
import { csrfTokenOf } from '../src/platform/http/session-cookies';
import { NoTenantContext } from '../src/platform/tenant-context/no-tenant-context.decorator';
import { IssuePortalChallenge } from '../src/modules/identity/application/use-cases/issue-portal-challenge.use-case';
import { RequestPortalCode } from '../src/modules/identity/application/use-cases/request-portal-code.use-case';
import { SignOut } from '../src/modules/identity/application/use-cases/sign-out.use-case';
import { VerifyPortalCode } from '../src/modules/identity/application/use-cases/verify-portal-code.use-case';
import { ViewOwnPortalAccount } from '../src/modules/identity/application/use-cases/view-own-portal-account.use-case';
import { createTestApp, type LogLine } from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

// The HTTP edge of portal sign-in (ADR-0026), without a database: the use cases and the
// authenticator are fakes, so what is checked is the controllers' own work: validation, the
// session cookie, the CSRF token, Retry-After, the status of each refusal, the population of
// the cookie and the client address behind a trusted proxy. The use cases run against
// PostgreSQL in test/db/identity-portal.db-spec.ts.

const ORIGIN = 'https://portal.example.test';
/** Matches the session token pattern; never in a log line. */
const TOKEN = 'P'.repeat(43);
const CHALLENGE_ID = '0190a000-0000-7000-8000-000000000001';
const ACCOUNT_ID = '0190a000-0000-7000-8000-000000000002';
const EXPIRES = Temporal.Instant.from('2026-10-29T10:00:00Z');
const ADDRESS = 'sentinel.address@example.test';

type Answer =
  | { ok: true; value: unknown }
  | { ok: false; error: { readonly code: string; readonly [field: string]: unknown } };
/** What each fake use case answers next; set by the test. */
const next: Record<string, Answer> = {};
const inputs: Record<string, unknown[]> = {};
const fake = (name: string) => ({
  execute: (_context: CallContext, input: unknown) => {
    (inputs[name] ??= []).push(input);
    return Promise.resolve(next[name]);
  },
});

const populations: (Population | undefined)[] = [];
class PortalOnlyAuthenticator implements Authenticator {
  authenticate(tenant: TenantContext, token: string, population?: Population) {
    populations.push(population);
    if (token !== TOKEN || population !== 'portal-user') {
      return Promise.resolve(err({ code: 'credential.rejected' as const }));
    }
    return Promise.resolve(
      ok(
        testAuthenticatedActor(tenant, {
          population: 'portal-user',
          accountId: ACCOUNT_ID as never,
          sessionId: CHALLENGE_ID as never,
        }),
      ),
    );
  }
}

/** Echoes the client address Express derived (trust proxy). */
@NoTenantContext()
@Controller('test-client-address')
class ClientAddressController {
  @Get()
  address(@Req() req: Request) {
    return { ip: req.ip };
  }
}

describe('the portal sign-in API (HTTP)', () => {
  let app: NestExpressApplication;
  let logLines: LogLine[];
  let secret: Buffer;

  beforeAll(async () => {
    ({ app, logLines } = await createTestApp({
      env: { PANEL_ORIGINS: ORIGIN, TRUSTED_PROXIES: '127.0.0.1,::1' },
      controllers: [ClientAddressController],
      override: (builder) =>
        builder
          .overrideProvider(AUTHENTICATOR)
          .useValue(new PortalOnlyAuthenticator())
          .overrideProvider(IssuePortalChallenge)
          .useValue(fake('challenge'))
          .overrideProvider(RequestPortalCode)
          .useValue(fake('code'))
          .overrideProvider(VerifyPortalCode)
          .useValue(fake('verify'))
          .overrideProvider(ViewOwnPortalAccount)
          .useValue(fake('me'))
          .overrideProvider(SignOut)
          .useValue(fake('signOut')),
    }));
    secret = app.get<AppConfig>(APP_CONFIG).session.secret;
  });

  afterAll(() => app.close());

  it('reads the client address from X-Forwarded-For of a trusted proxy only', async () => {
    const response = await request(app.getHttpServer())
      .get('/test-client-address')
      .set('x-forwarded-for', '6.6.6.6, 203.0.113.7');
    // The socket is 127.0.0.1 (trusted): the rightmost untrusted entry is the client.
    expect(response.body).toEqual({ ip: '203.0.113.7' });
  });

  describe.each(TEST_TENANTS)('in tenant %s', (tenant) => {
    const call = (method: 'get' | 'post' | 'put', path: string) =>
      request(app.getHttpServer())[method](path).set('x-tenant-id', tenant);
    const sendCode = { method: 'email', address: ADDRESS, captcha: 'c' };
    const signIn = { challengeId: CHALLENGE_ID, method: 'email', address: ADDRESS, code: '123456' };

    it('starts a session: a Secure, HttpOnly, Lax __Host- cookie and its CSRF token', async () => {
      next.verify = {
        ok: true,
        value: { sessionToken: TOKEN, expiresAt: EXPIRES, accountId: ACCOUNT_ID },
      };
      const response = await call('post', '/identity/portal/sign-in')
        .set('x-forwarded-for', '203.0.113.9')
        .send(signIn);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        accountId: ACCOUNT_ID,
        expiresAt: EXPIRES.toString(),
        csrfToken: csrfTokenOf(secret, TOKEN),
      });
      const [cookie] = response.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(new RegExp(`^__Host-phoenix-portal=${TOKEN};`));
      for (const part of ['; Path=/', '; HttpOnly', '; Secure', '; SameSite=Lax']) {
        expect(cookie).toContain(part);
      }
      expect(cookie).toContain(`Expires=${new Date(EXPIRES.epochMilliseconds).toUTCString()}`);
      expect(inputs.verify?.at(-1)).toMatchObject({ clientAddress: '203.0.113.9' });
    });

    it.each([
      ['portal.code-invalid', 400],
      ['portal.account-disabled', 403],
      ['portal.method-unavailable', 409],
      ['portal.unavailable', 503],
      ['identity.value.invalid', 400],
    ])('answers %s with %i and sets no cookie, logging no address', async (code, status) => {
      next.verify = { ok: false, error: { code, field: 'address' } };
      const response = await call('post', '/identity/portal/sign-in').send(signIn);
      expect(response.status).toBe(status);
      expect((response.body as { code: string }).code).toBe(code);
      expect(response.headers['set-cookie']).toBeUndefined();
      const text = JSON.stringify(logLines);
      expect(text).not.toContain(ADDRESS);
      expect(text).not.toContain(TOKEN);
    });

    it('answers a rate-limited code request with 429 and Retry-After', async () => {
      next.code = { ok: false, error: { code: 'rate-limit.exceeded', retryAfterSeconds: 120 } };
      const response = await call('post', '/identity/portal/code').send(sendCode);
      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBe('120');
    });

    it.each([
      ['portal.delivery-failed', 503],
      ['captcha.invalid', 400],
    ])('answers a code request refused with %s by %i', async (code, status) => {
      next.code = { ok: false, error: { code } };
      const response = await call('post', '/identity/portal/code').send(sendCode);
      expect(response.status).toBe(status);
    });

    it.each([
      ['/identity/portal/code', { ...sendCode, extra: 1 }],
      ['/identity/portal/code', { ...sendCode, address: 'a'.repeat(321) }],
      ['/identity/portal/code', { ...sendCode, method: 'fax' }],
      ['/identity/portal/sign-in', { ...signIn, challengeId: 'not-an-id' }],
      ['/identity/portal/sign-in', { ...signIn, code: '1'.repeat(17) }],
    ])('refuses a malformed body of %s before the use case', async (path, body) => {
      const before = (inputs.code?.length ?? 0) + (inputs.verify?.length ?? 0);
      const response = await call('post', path).send(body);
      expect(response.status).toBe(400);
      expect((inputs.code?.length ?? 0) + (inputs.verify?.length ?? 0)).toBe(before);
    });

    it("reads the signed-in user with the session's CSRF token", async () => {
      next.me = { ok: true, value: { accountId: ACCOUNT_ID, contacts: [] } };
      const response = await call('get', '/identity/portal/me').set(
        'cookie',
        `__Host-phoenix-portal=${TOKEN}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        accountId: ACCOUNT_ID,
        contacts: [],
        csrfToken: csrfTokenOf(secret, TOKEN),
      });
      expect(populations.at(-1)).toBe('portal-user');
    });

    it('refuses a portal token in the studio cookie, and two session cookies at once', async () => {
      const studio = await call('get', '/identity/portal/me').set(
        'cookie',
        `__Host-phoenix-studio=${TOKEN}`,
      );
      expect(studio.status).toBe(401);
      expect(populations.at(-1)).toBe('tenant-staff');
      const both = await call('get', '/identity/portal/me').set(
        'cookie',
        `__Host-phoenix-studio=${TOKEN}; __Host-phoenix-portal=${TOKEN}`,
      );
      expect(both.status).toBe(401);
      expect(both.body).toEqual({ statusCode: 401, code: 'session.invalid' });
    });

    it('signs out with Origin and the CSRF token only, and clears the cookie', async () => {
      next.signOut = { ok: true, value: undefined };
      const cookie = `__Host-phoenix-portal=${TOKEN}`;
      const refused = await call('post', '/identity/portal/sign-out')
        .set('cookie', cookie)
        .set('origin', ORIGIN);
      expect(refused.status).toBe(403);
      const response = await call('post', '/identity/portal/sign-out')
        .set('cookie', cookie)
        .set('origin', ORIGIN)
        .set('x-csrf-token', csrfTokenOf(secret, TOKEN));
      expect(response.status).toBe(204);
      const [cleared] = response.headers['set-cookie'] as unknown as string[];
      expect(cleared).toMatch(/^__Host-phoenix-portal=;/);
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    });

    it.each([
      // The real gate: these use cases are not faked here.
      ['get', '/identity/portal-sign-in-settings'],
      ['put', '/identity/portal-sign-in-settings'],
    ] as const)('refuses an anonymous %s %s with 401', async (method, path) => {
      const response = await call(method, path).send({
        version: 0,
        methods: ['email'],
        countryCallingCode: null,
      });
      expect(response.status).toBe(401);
    });
  });
});
