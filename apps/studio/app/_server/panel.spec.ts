import { apiUrlOf, readPanelServerConfig } from '@phoenix/panel-server';

// The routes the studio's browser may reach through its relay: exactly what its screens call
// (I3). A route left out answers 404 at the BFF; widening the list back to a whole module
// fails here.

jest.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { STUDIO_API_PREFIXES } from './panel';

const config = readPanelServerConfig(
  {
    PHOENIX_API_URL: 'http://api.internal:3000',
    STUDIO_TENANT_HOSTS: 'fa.localhost:3001=demo-fa,en.localhost:3001=demo-en',
  },
  'STUDIO_TENANT_HOSTS',
);
const relays = (route: string) => apiUrlOf(config, route.split('/'), STUDIO_API_PREFIXES) !== null;
const ID = '0190a000-0000-7000-8000-000000000001';

describe('studio relay allow-list', () => {
  it.each([
    'tenancy/sites',
    `tenancy/sites/${ID}`,
    `tenancy/sites/${ID}/move`,
    `tenancy/sites/${ID}/domains`,
    `tenancy/site-domains/${ID}`,
    'tenancy/organizations',
    `tenancy/organizations/${ID}`,
    `tenancy/organizations/${ID}/move`,
    'identity/roles',
  ])('relays %s', (route) => {
    expect(relays(route)).toBe(true);
  });

  it.each(['tenancy/settings', 'tenancy/presentation', 'tenancy', 'process/definitions'])(
    'refuses %s',
    (route) => {
      expect(relays(route)).toBe(false);
    },
  );
});
