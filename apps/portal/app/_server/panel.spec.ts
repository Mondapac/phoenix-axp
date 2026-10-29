import { apiUrlOf, readPanelServerConfig } from '@phoenix/panel-server';

// The portal relays the sign-in routes only (ADR-0026), and sends the anonymous ones no cookie.

jest.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import {
  ANONYMOUS_API_PREFIXES,
  PORTAL_API_PREFIXES,
  portalServerConfig,
  relayedRequest,
  startsWithAny,
} from './panel';

const config = readPanelServerConfig(
  {
    PHOENIX_API_URL: 'http://api.internal:3000/',
    PORTAL_TENANT_HOSTS: 'portal.fa.test=demo-fa,portal.en.test:3002=demo-en',
  },
  'PORTAL_TENANT_HOSTS',
);

describe('the portal relay allow-list', () => {
  it.each([
    'identity/portal/challenge',
    'identity/portal/code',
    'identity/portal/sign-in',
    'identity/portal/sign-out',
  ])('relays %s', (route) => {
    expect(apiUrlOf(config, route.split('/'), PORTAL_API_PREFIXES)).not.toBeNull();
  });

  it.each([
    'identity/staff/me',
    'identity/portal-sign-in-settings',
    'identity/roles',
    'tenancy/sites',
    'forms/forms',
  ])('relays no route outside sign-in (%s)', (route) => {
    expect(apiUrlOf(config, route.split('/'), PORTAL_API_PREFIXES)).toBeNull();
  });

  it('sends a cookie to sign-out only', () => {
    for (const route of ['challenge', 'code', 'sign-in']) {
      expect(startsWithAny(['identity', 'portal', route], ANONYMOUS_API_PREFIXES)).toBe(true);
    }
    expect(startsWithAny(['identity', 'portal', 'sign-out'], ANONYMOUS_API_PREFIXES)).toBe(false);
  });
});

describe('the portal configuration', () => {
  const env = {
    PHOENIX_API_URL: 'http://api.internal:3000/',
    PORTAL_TENANT_HOSTS: 'portal.fa.test=demo-fa,portal.en.test:3002=demo-en',
  };

  it('needs a proxy that writes the visitor address in production', () => {
    expect(() => portalServerConfig({ ...env, NODE_ENV: 'production' })).toThrow(
      'PANEL_PROXY_HOPS',
    );
    expect(
      portalServerConfig({ ...env, NODE_ENV: 'production', PANEL_PROXY_HOPS: '1' }).proxyHops,
    ).toBe(1);
    expect(portalServerConfig({ ...env, NODE_ENV: 'development' }).proxyHops).toBe(0);
  });
});

describe('relayedRequest', () => {
  const browser = () =>
    new Request('http://portal.fa.test/api/identity/portal/code', {
      method: 'POST',
      headers: { cookie: '__Host-phoenix-portal=stale', origin: 'http://portal.fa.test' },
      body: JSON.stringify({ method: 'email' }),
    });

  it('drops the cookies of an anonymous sign-in route and keeps the rest', async () => {
    const relayed = relayedRequest(browser(), ['identity', 'portal', 'code']);
    expect(relayed.headers.get('cookie')).toBeNull();
    expect(relayed.headers.get('origin')).toBe('http://portal.fa.test');
    expect(await relayed.text()).toBe('{"method":"email"}');
  });

  it('keeps the session cookie of sign-out', () => {
    const relayed = relayedRequest(browser(), ['identity', 'portal', 'sign-out']);
    expect(relayed.headers.get('cookie')).toBe('__Host-phoenix-portal=stale');
  });
});
