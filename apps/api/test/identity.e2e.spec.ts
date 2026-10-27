import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp, type LogLine } from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

// The HTTP edge of the identity module (slice 1.5), without a database: what the ActorGuard and
// the gate decide before any unit of work opens, and the start of a sign-in. Sessions, accounts
// and the authorisation check against PostgreSQL are in test/db/identity.db-spec.ts.

const KEYCLOAK = {
  KEYCLOAK_URL: 'https://sso.example.test',
  KEYCLOAK_STUDIO_CLIENT_SECRET: 'client-secret-sentinel',
  STUDIO_SIGN_IN_CALLBACK_URL: 'https://studio.example.test/auth/callback',
  PANEL_ORIGINS: 'https://studio.example.test',
};
/** Matches the session token pattern, so it would be looked up: never in any log line. */
const TOKEN = 'T'.repeat(43);

describe('the identity API (HTTP)', () => {
  let app: NestExpressApplication;
  let logLines: LogLine[];
  let unconfigured: NestExpressApplication;

  beforeAll(async () => {
    ({ app, logLines } = await createTestApp({ env: KEYCLOAK }));
    ({ app: unconfigured } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await unconfigured.close();
  });

  describe.each(TEST_TENANTS)('in tenant %s', (tenant) => {
    const call = (method: 'get' | 'post', path: string, target = app) =>
      request(target.getHttpServer())[method](path).set('x-tenant-id', tenant);

    it("redirects a sign-in to the tenant's realm with a Lax flow cookie", async () => {
      const response = await call('get', '/identity/staff/sign-in');
      expect(response.status).toBe(302);
      const location = new URL(response.headers.location as string);
      expect(location.pathname).toBe(`/realms/phoenix-${tenant}/protocol/openid-connect/auth`);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      const [cookie] = response.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(/^__Host-phoenix-flow=[A-Za-z0-9_-]{43};/);
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; Secure/);
      expect(cookie).toMatch(/; SameSite=Lax/);
    });

    it('answers 503 sign-in.unavailable while Keycloak is not configured', async () => {
      const response = await call('get', '/identity/staff/sign-in', unconfigured);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ statusCode: 503, code: 'sign-in.unavailable' });
    });

    it('answers 400 sign-in.flow-invalid to a callback without its flow cookie', async () => {
      const response = await call('get', '/identity/staff/sign-in/callback?code=c&state=s');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ statusCode: 400, code: 'sign-in.flow-invalid' });
    });

    it('logs a refused sign-in with its reason, never the code or the state', async () => {
      const code = 'code-sentinel-4f1c';
      const state = 'state-sentinel-9b2e';
      const response = await call(
        'get',
        `/identity/staff/sign-in/callback?code=${code}&state=${state}`,
      ).set('x-correlation-id', `refused-${tenant}`);
      expect(response.status).toBe(400);
      const refused = logLines.filter(
        (line) =>
          line.msg === 'identity.sign-in.refused' &&
          (line as Record<string, unknown>).tenantId === tenant,
      );
      expect(refused.length).toBeGreaterThan(0);
      expect(refused.at(-1)).toMatchObject({
        reason: 'sign-in.flow-invalid',
        accountId: null,
        tenantId: tenant,
      });
      const text = JSON.stringify(refused);
      expect(text).not.toContain(code);
      expect(text).not.toContain(state);
    });

    it.each([
      ['get', '/identity/staff/me'],
      ['post', '/identity/staff/sign-out'],
      ['get', '/identity/staff-accounts'],
      ['post', '/identity/staff-accounts'],
    ] as const)('refuses an anonymous %s %s with 401', async (method, path) => {
      const response = await call(method, path).send({ username: 'x' });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, code: 'access.unauthenticated' });
    });

    it('answers 401 session.invalid to a cookie that is not a session', async () => {
      const response = await call('get', '/identity/staff/me').set(
        'cookie',
        '__Host-phoenix-studio=not-a-token',
      );
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, code: 'session.invalid' });
    });

    it('answers 403 csrf.invalid to a state-changing request without Origin or token', async () => {
      for (const headers of [
        {},
        { origin: 'https://studio.example.test' },
        { origin: 'https://evil.example.test', 'x-csrf-token': 'x' },
      ]) {
        const response = await call('post', '/identity/staff/sign-out')
          .set('cookie', `__Host-phoenix-studio=${TOKEN}`)
          .set(headers);
        expect(response.status).toBe(403);
        expect(response.body).toEqual({ statusCode: 403, code: 'csrf.invalid' });
      }
    });
  });

  it('never logs a session token or the client secret', () => {
    expect(logLines.some((line) => line.msg === 'actor.refused')).toBe(true);
    const text = JSON.stringify(logLines);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('client-secret-sentinel');
  });
});
