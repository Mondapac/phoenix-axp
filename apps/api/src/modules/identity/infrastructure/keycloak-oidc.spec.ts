import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { Temporal } from '@phoenix/shared-kernel';
import { FixedClock, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../test/support/test-config';
import type { KeycloakConfig } from '../../../platform/config/app-config';
import { SignInFlows } from '../application/sign-in-flow';
import { KeycloakOidc, realmIssuer } from './keycloak-oidc';

const CONFIG: KeycloakConfig = {
  url: 'https://sso.example.test',
  realmTemplate: 'phoenix-{tenant}',
  studioClientId: 'phoenix-studio',
  studioClientSecret: 'client-secret',
  studioCallbackUrl: 'https://studio.example.test/auth/callback',
  directoryClaim: 'ldap_id',
  adminClientId: 'phoenix-core-admin',
  adminClientSecret: null,
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const NOW = Temporal.Instant.from('2026-10-27T12:00:00Z');
const NOW_S = NOW.epochMilliseconds / 1000;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function jwt(claims: Record<string, unknown>, key: KeyObject = privateKey, kid = 'k1'): string {
  const head = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}

describe.each(TEST_TENANTS)('KeycloakOidc in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const issuer = realmIssuer(CONFIG, tenant);
  const flows = new SignInFlows(Buffer.alloc(32, 3));
  const flow = flows.derive(flows.issue(), tenant)!;
  const claims = (overrides: Record<string, unknown> = {}) => ({
    iss: issuer,
    aud: 'phoenix-studio',
    sub: 'subject-1',
    preferred_username: 'Sara',
    nonce: flow.nonce,
    sid: 'sid-1',
    iat: NOW_S,
    exp: NOW_S + 300,
    ...overrides,
  });

  /** Keycloak's token and certs endpoints, answering `idToken`; records the requests. */
  function keycloak(idToken: string | null, tokenStatus = 200) {
    const requests: { url: string; body: string }[] = [];
    const fetchFn = ((url: string, init: { body?: string }) => {
      requests.push({ url, body: init.body ?? '' });
      const json = url.endsWith('/certs')
        ? {
            keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }],
          }
        : idToken === null
          ? { error: 'invalid_grant' }
          : { id_token: idToken, access_token: 'dropped' };
      return Promise.resolve(
        new Response(JSON.stringify(json), { status: url.endsWith('/certs') ? 200 : tokenStatus }),
      );
    }) as unknown as typeof fetch;
    return { oidc: new KeycloakOidc(CONFIG, new FixedClock(NOW), fetchFn), requests };
  }

  it("builds the authorization URL of the tenant's realm, with PKCE S256", () => {
    const url = new URL(keycloak(null).oidc.authorizationUrl(tenant, flow));
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://sso.example.test/realms/phoenix-${code}/protocol/openid-connect/auth`,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'phoenix-studio',
      redirect_uri: CONFIG.studioCallbackUrl,
      scope: 'openid',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: flow.codeChallenge,
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code with the verifier and reads a verified ID token', async () => {
    const { oidc, requests } = keycloak(jwt(claims({ ldap_id: 'entry-uuid' })));
    expect(await oidc.exchange(tenant, 'code-1', flow)).toEqual({
      ok: true,
      value: { subject: 'subject-1', username: 'sara', directory: true, idpSessionId: 'sid-1' },
    });
    const body = new URLSearchParams(requests[0]!.body);
    expect(body.get('code_verifier')).toBe(flow.codeVerifier);
    expect(body.get('code')).toBe('code-1');
    expect(requests[0]!.url).toBe(`${issuer}/protocol/openid-connect/token`);
  });

  it('reads a user without the directory claim as local', async () => {
    const { oidc } = keycloak(jwt(claims()));
    const result = await oidc.exchange(tenant, 'c', flow);
    expect(result.ok && result.value.directory).toBe(false);
  });

  it.each([
    ['another nonce', claims({ nonce: 'other' })],
    ['another issuer', claims({ iss: 'https://sso.example.test/realms/phoenix-elsewhere' })],
    ['another audience', claims({ aud: 'phoenix-portal' })],
    ['an expired token', claims({ exp: NOW_S - 120 })],
    ['a token from the future', claims({ iat: NOW_S + 600 })],
    ['no subject', claims({ sub: undefined })],
  ])('rejects %s', async (_label, payload) => {
    const { oidc } = keycloak(jwt(payload));
    expect(await oidc.exchange(tenant, 'c', flow)).toEqual({
      ok: false,
      error: 'provider.rejected',
    });
  });

  it('rejects a forged signature and an unknown key', async () => {
    expect(
      await keycloak(jwt(claims(), other.privateKey)).oidc.exchange(tenant, 'c', flow),
    ).toEqual({ ok: false, error: 'provider.rejected' });
    expect(
      await keycloak(jwt(claims(), privateKey, 'k2')).oidc.exchange(tenant, 'c', flow),
    ).toEqual({ ok: false, error: 'provider.rejected' });
  });

  it('answers unavailable when Keycloak fails, rejected when it refuses the code', async () => {
    expect(await keycloak(null, 503).oidc.exchange(tenant, 'c', flow)).toEqual({
      ok: false,
      error: 'provider.unavailable',
    });
    expect(await keycloak(null, 400).oidc.exchange(tenant, 'c', flow)).toEqual({
      ok: false,
      error: 'provider.rejected',
    });
    const down = new KeycloakOidc(CONFIG, new FixedClock(NOW), () =>
      Promise.reject(new Error('ECONNREFUSED')),
    );
    expect(await down.exchange(tenant, 'c', flow)).toEqual({
      ok: false,
      error: 'provider.unavailable',
    });
  });
});
