import { apiUrlOf, readPanelServerConfig } from '@phoenix/panel-server';

// The portal relays the sign-in routes only (ADR-0026), and sends the anonymous ones no cookie.

jest.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { ANONYMOUS_API_PREFIXES, PORTAL_API_PREFIXES, startsWithAny } from './panel';

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
