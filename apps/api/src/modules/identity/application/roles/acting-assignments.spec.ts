import { TEST_TENANTS } from '../../../../../test/support/test-config';
import { effectiveKeysOf, grantingActorsOf, heldKeysOf, keyFitsRole } from './acting-assignments';
import {
  testCatalogue,
  testGrant,
  testId,
  testRole,
} from '../../../../../test/support/role-catalogue';

const MANAGE = 'identity.role-assignments.manage';

// Tests first for the role model (working rule 4); the same in both tenant fixtures (rule 5).
describe.each(TEST_TENANTS)('acting assignments (tenant %s)', () => {
  it('gives a system tenant role every tenant and site key, never a platform key', () => {
    const keys = effectiveKeysOf(testRole({ kind: 'system' }), testCatalogue);
    expect(keys.has('identity.accounts.manage')).toBe(true);
    expect(keys.has('content.items.edit')).toBe(true);
    expect(keys.has('platform.tenants.manage')).toBe(false);
  });

  it('gives a custom role its declared keys of a fitting scope only', () => {
    const tenantRole = testRole({
      permissionKeys: ['identity.accounts.view', 'content.items.edit', 'gone.key.x'],
    });
    expect([...effectiveKeysOf(tenantRole, testCatalogue)].sort()).toEqual([
      'content.items.edit',
      'identity.accounts.view',
    ]);
    const siteRole = testRole({
      scope: 'site',
      permissionKeys: ['identity.accounts.view', 'content.items.edit'],
    });
    expect([...effectiveKeysOf(siteRole, testCatalogue)]).toEqual(['content.items.edit']);
  });

  it('fits a key to a role scope by its declared scope', () => {
    expect(keyFitsRole('content.items.edit', 'site', testCatalogue)).toBe(true);
    expect(keyFitsRole('identity.accounts.view', 'site', testCatalogue)).toBe(false);
    expect(keyFitsRole('identity.accounts.view', 'tenant', testCatalogue)).toBe(true);
    expect(keyFitsRole('platform.tenants.manage', 'tenant', testCatalogue)).toBe(false);
    expect(keyFitsRole('unknown.key.x', 'tenant', testCatalogue)).toBe(false);
  });

  it('counts a grant only at its role level and for a population that may hold it', () => {
    const role = testRole({ permissionKeys: ['identity.accounts.view'] });
    const misplaced = testGrant(role, { level: 'site', siteId: testId<'Site'>() });
    expect(heldKeysOf([misplaced], 'tenant-staff', testCatalogue).size).toBe(0);
    expect(heldKeysOf([testGrant(role)], 'portal-user', testCatalogue).size).toBe(0);
    expect([...heldKeysOf([testGrant(role)], 'tenant-staff', testCatalogue)]).toEqual([
      'identity.accounts.view',
    ]);
  });

  it('lists the grants that confer the key, system role first, with their placement', () => {
    const account = testId<'Account'>();
    const siteId = testId<'Site'>();
    const site = testGrant(testRole({ scope: 'site', permissionKeys: [MANAGE] }), {
      level: 'site',
      siteId,
      includeDescendants: true,
    });
    const viewer = testGrant(testRole({ permissionKeys: ['identity.accounts.view'] }));
    const system = testGrant(testRole({ kind: 'system' }));

    const actors = grantingActorsOf(
      account,
      'tenant-staff',
      [site, viewer, system],
      MANAGE,
      testCatalogue,
    );

    expect(actors.map((a) => [a.roleId, a.holdsSystemRole, a.scope])).toEqual([
      [system.role.id, true, { level: 'tenant' }],
      [site.role.id, false, { level: 'site', siteId, includeDescendants: true }],
    ]);
    expect(actors.every((a) => a.accountId === account)).toBe(true);
  });
});
