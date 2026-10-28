import { heldKeys, visibleMenu, type MenuEntry } from './menu';

const MENU: MenuEntry[] = [
  { href: '/', label: 'home', icon: 'home', anyOf: [] },
  {
    href: '/people',
    label: 'people',
    anyOf: [],
    children: [
      { href: '/people/accounts', label: 'accounts', anyOf: ['identity.accounts.view'] },
      { href: '/people/roles', label: 'roles', anyOf: ['identity.roles.view'] },
    ],
  },
  { href: '/sites', label: 'sites', anyOf: ['tenancy.sites.view', 'tenancy.sites.manage'] },
];

describe('the permission-based menu', () => {
  it('shows every member the open entries only', () => {
    const shown = visibleMenu(MENU, heldKeys({ tenant: [], sites: [] }), '/');
    expect(shown).toEqual([{ href: '/', label: 'home', icon: 'home', active: true, children: [] }]);
  });

  it('shows an entry for any of its keys, tenant-wide or held on a site', () => {
    const held = heldKeys({
      tenant: ['identity.roles.view'],
      sites: [{ keys: ['tenancy.sites.manage'] }],
    });
    const shown = visibleMenu(MENU, held, '/people/roles/42');
    expect(shown.map((entry) => entry.href)).toEqual(['/', '/people', '/sites']);
    expect(shown[1]?.children).toEqual([
      { href: '/people/roles', label: 'roles', active: true, children: [] },
    ]);
    expect(shown[0]?.active).toBe(false);
  });

  it('marks a page current by path segment, not by prefix text', () => {
    const held = heldKeys({ tenant: ['tenancy.sites.view'], sites: [] });
    expect(visibleMenu(MENU, held, '/sites-old').find((e) => e.href === '/sites')?.active).toBe(
      false,
    );
    expect(visibleMenu(MENU, held, '/sites').find((e) => e.href === '/sites')?.active).toBe(true);
  });
});
