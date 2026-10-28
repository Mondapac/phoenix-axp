import { messagesFor } from '../_i18n/messages';
import {
  canOfferDisable,
  canOfferGrant,
  grantableRoles,
  isRoleKey,
  isUsername,
  kindLabel,
  moduleLabel,
  permissionGroups,
  permissionLabel,
  roleName,
  scopeLabel,
  type PermissionDeclaration,
  type Role,
  type StaffAccount,
} from './people';

// The two tenant fixtures' languages (config/tenants: demo-fa and demo-en).
const TENANTS = [
  { name: 'demo-fa', locale: 'fa-IR' },
  { name: 'demo-en', locale: 'en-CA' },
] as const;

const catalogue: PermissionDeclaration[] = [
  { key: 'identity.accounts.view', scope: 'tenant', protected: false },
  { key: 'identity.role-assignments.manage', scope: 'site', protected: true },
  { key: 'tenancy.sites.view', scope: 'tenant', protected: false },
  { key: 'tenancy.sites.manage', scope: 'site', protected: false },
  { key: 'platform.tenants.manage', scope: 'platform', protected: true },
];

const account = (over: Partial<StaffAccount> = {}): StaffAccount => ({
  id: '0190a000-0000-7000-8000-000000000001',
  source: 'local',
  username: 'sara',
  status: 'active',
  signedInOnce: true,
  version: 1,
  createdAt: '2026-10-28T08:00:00Z',
  ...over,
});

describe('permissionGroups', () => {
  it('groups by module the keys a tenant role may confer: tenant and site keys', () => {
    expect(permissionGroups(catalogue, 'tenant')).toEqual([
      { module: 'identity', keys: [catalogue[0], catalogue[1]] },
      { module: 'tenancy', keys: [catalogue[2], catalogue[3]] },
    ]);
  });

  it('gives a site role only site keys', () => {
    expect(permissionGroups(catalogue, 'site').flatMap((g) => g.keys.map((k) => k.key))).toEqual([
      'identity.role-assignments.manage',
      'tenancy.sites.manage',
    ]);
  });

  it('never offers a platform key to a tenant or site role', () => {
    for (const scope of ['tenant', 'site'] as const) {
      const keys = permissionGroups(catalogue, scope).flatMap((g) => g.keys.map((k) => k.key));
      expect(keys).not.toContain('platform.tenants.manage');
    }
  });
});

describe('what the screens offer', () => {
  const own = '0190a000-0000-7000-8000-0000000000ff';

  it('offers to disable an active local account that is not the member’s own', () => {
    expect(canOfferDisable(account(), own)).toBe(true);
    expect(canOfferDisable(account({ id: own }), own)).toBe(false);
    expect(canOfferDisable(account({ source: 'directory' }), own)).toBe(false);
    expect(canOfferDisable(account({ status: 'disabled' }), own)).toBe(false);
  });

  it('offers a grant only to an active account whose person has signed in', () => {
    expect(canOfferGrant(account())).toBe(true);
    expect(canOfferGrant(account({ signedInOnce: false }))).toBe(false);
    expect(canOfferGrant(account({ status: 'disabled' }))).toBe(false);
  });

  it('offers tenant and site roles for a grant, never a platform role', () => {
    const role = (scope: Role['scope']): Role => ({
      id: scope,
      key: `${scope}-role`,
      kind: 'custom',
      scope,
      permissionKeys: [],
      version: 1,
    });
    expect(
      grantableRoles([role('platform'), role('tenant'), role('site')]).map((r) => r.id),
    ).toEqual(['tenant', 'site']);
  });

  it('checks role keys and usernames as the API does', () => {
    expect(isRoleKey('content-editor')).toBe(true);
    expect(isRoleKey(' Content-Editor ')).toBe(true);
    expect(isRoleKey('a')).toBe(false);
    expect(isRoleKey('content--editor')).toBe(false);
    expect(isRoleKey('ویرایشگر')).toBe(false);
    expect(isUsername('sara.ahmadi@example')).toBe(true);
    expect(isUsername('-sara')).toBe(false);
    expect(isUsername('سارا')).toBe(false);
  });
});

describe.each(TENANTS)('labels for $name', ({ locale }) => {
  const t = messagesFor(locale);

  it('reads every catalogue key the API declares today', () => {
    for (const key of ['identity.accounts.view', 'tenancy.sites.manage']) {
      expect(permissionLabel(t, key)).not.toBe(key);
    }
  });

  it('falls back to the key for a permission, module or role the studio has no text for', () => {
    expect(permissionLabel(t, 'objects.records.view')).toBe('objects.records.view');
    expect(moduleLabel(t, 'objects')).toBe('objects');
    expect(roleName(t, 'content-editor')).toBe('content-editor');
  });

  it('names the platform-seeded system role and every kind and scope', () => {
    expect(roleName(t, 'tenant-administrator')).not.toBe('tenant-administrator');
    for (const kind of ['system', 'default', 'custom'] as const)
      expect(kindLabel(t, kind)).toBeTruthy();
    for (const scope of ['platform', 'tenant', 'site'] as const)
      expect(scopeLabel(t, scope)).toBeTruthy();
  });

  it('never reads a key built from data outside the studio texts', () => {
    expect(permissionLabel(t, '__proto__')).toBe('__proto__');
    expect(roleName(t, 'constructor')).toBe('constructor');
  });
});
