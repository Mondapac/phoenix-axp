import { Temporal } from '@phoenix/shared-kernel';
import { FixedClock, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../test/support/test-config';
import type { KeycloakConfig } from '../../../platform/config/app-config';
import { KeycloakDirectory, UnconfiguredDirectory } from './keycloak-directory';

const CONFIG: KeycloakConfig = {
  url: 'https://sso.example.test',
  realmTemplate: 'phoenix-{tenant}',
  studioClientId: 'phoenix-studio',
  studioClientSecret: 'client-secret',
  studioCallbackUrl: 'https://studio.example.test/auth/callback',
  directoryClaim: 'ldap_id',
  adminClientId: 'phoenix-core-admin',
  adminClientSecret: 'admin-secret',
};
const NOW = Temporal.Instant.from('2026-10-27T12:00:00Z');

type Answer = { status: number; json: unknown } | 'throw';

describe.each(TEST_TENANTS)('KeycloakDirectory in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const admin = `https://sso.example.test/admin/realms/phoenix-${code}/users/`;

  /** Keycloak: the token endpoint, then one answer per user id; records the requests. */
  function keycloak(users: Record<string, Answer>, token: Answer = tokenAnswer()) {
    const requests: { url: string; authorization?: string; body?: string }[] = [];
    const fetchFn = ((url: string, init: { headers: Record<string, string>; body?: string }) => {
      requests.push({ url, authorization: init.headers.authorization, body: init.body });
      const answer = url.endsWith('/token')
        ? token
        : (users[decodeURIComponent(url.slice(admin.length))] ?? { status: 500, json: null });
      if (answer === 'throw') return Promise.reject(new Error('down'));
      return Promise.resolve(new Response(JSON.stringify(answer.json), { status: answer.status }));
    }) as unknown as typeof fetch;
    return { requests, directory: new KeycloakDirectory(CONFIG, new FixedClock(NOW), fetchFn) };
  }
  function tokenAnswer(expiresIn = 300): Answer {
    return { status: 200, json: { access_token: 'admin-token', expires_in: expiresIn } };
  }
  const user = (id: string, enabled: boolean): Answer => ({ status: 200, json: { id, enabled } });

  it("reads each user from the tenant's realm with a service-account token", async () => {
    const { directory, requests } = keycloak({
      a: user('a', true),
      b: user('b', false),
      c: { status: 404, json: { error: 'User not found' } },
    });
    const answer = await directory.statusOf(tenant, ['a', 'b', 'c']);
    expect(answer.ok && Object.fromEntries(answer.value)).toEqual({
      a: 'enabled',
      b: 'disabled',
      c: 'missing',
    });
    const [token, ...lookups] = requests;
    expect(token!.url).toBe(
      `https://sso.example.test/realms/phoenix-${code}/protocol/openid-connect/token`,
    );
    expect(new URLSearchParams(token!.body)).toEqual(
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'phoenix-core-admin',
        client_secret: 'admin-secret',
      }),
    );
    expect(lookups.map((request) => request.url).sort()).toEqual(
      ['a', 'b', 'c'].map((id) => `${admin}${id}`),
    );
    expect(lookups.every((request) => request.authorization === 'Bearer admin-token')).toBe(true);
  });

  it('reuses the token until shortly before it expires', async () => {
    const { directory, requests } = keycloak({ a: user('a', true) });
    await directory.statusOf(tenant, ['a']);
    await directory.statusOf(tenant, ['a']);
    expect(requests.filter((request) => request.url.endsWith('/token'))).toHaveLength(1);
  });

  it('answers unavailable when any one user cannot be read, never a partial map', async () => {
    for (const broken of [
      { status: 500, json: null },
      { status: 200, json: { id: 'someone-else', enabled: false } },
      { status: 200, json: { id: 'b' } },
      'throw',
    ] as const) {
      const { directory } = keycloak({ a: user('a', true), b: broken });
      expect(await directory.statusOf(tenant, ['a', 'b'])).toEqual({
        ok: false,
        error: 'directory.unavailable',
      });
    }
  });

  it('answers unavailable without a token, and without the admin secret asks nothing', async () => {
    for (const token of [
      { status: 401, json: { error: 'unauthorized_client' } },
      'throw',
    ] as const) {
      const { directory } = keycloak({ a: user('a', true) }, token);
      expect((await directory.statusOf(tenant, ['a'])).ok).toBe(false);
    }
    const requests: string[] = [];
    const unconfigured = new KeycloakDirectory(
      { ...CONFIG, adminClientSecret: null },
      new FixedClock(NOW),
      ((url: string) => {
        requests.push(url);
        return Promise.reject(new Error('unexpected'));
      }) as unknown as typeof fetch,
    );
    expect((await unconfigured.statusOf(tenant, ['a'])).ok).toBe(false);
    expect(requests).toEqual([]);
    expect((await new UnconfiguredDirectory().statusOf()).ok).toBe(false);
  });

  it('counts only Keycloak\'s own "not found" as gone, and drops a refused token', async () => {
    const bare = keycloak({ a: { status: 404, json: null } });
    expect((await bare.directory.statusOf(tenant, ['a'])).ok).toBe(false);

    const { directory, requests } = keycloak({ a: { status: 401, json: { error: 'x' } } });
    expect((await directory.statusOf(tenant, ['a'])).ok).toBe(false);
    await directory.statusOf(tenant, ['a']);
    expect(requests.filter((request) => request.url.endsWith('/token'))).toHaveLength(2);
  });

  it('escapes the subject in the admin URL', async () => {
    const { directory, requests } = keycloak({ '../x': user('../x', true) });
    await directory.statusOf(tenant, ['../x']);
    expect(requests.at(-1)!.url).toBe(`${admin}..%2Fx`);
  });
});
