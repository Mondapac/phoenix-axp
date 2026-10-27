import type { PermissionScope } from '../../../../platform/authz';
import { TEST_TENANTS } from '../../../../../test/support/test-config';
import type { AssignedRole } from '../session.repository';
import { holdsEveryKey } from './held-keys';

const SCOPES: Record<string, PermissionScope> = {
  'identity.accounts.view': 'tenant',
  'identity.accounts.manage': 'tenant',
  'content.items.edit': 'site',
  'platform.tenants.manage': 'platform',
};
const scopeOf = (key: string) => SCOPES[key];

const assigned = (overrides: Partial<AssignedRole>): AssignedRole => ({
  level: 'tenant',
  siteId: null,
  includeDescendants: false,
  roleKind: 'custom',
  roleScope: 'tenant',
  permissionKeys: [],
  ...overrides,
});

// Tests first for the role model (working rule 4); the same in both tenant fixtures (rule 5).
describe.each(TEST_TENANTS)('holdsEveryKey (tenant %s)', () => {
  it('holds the listed keys of a custom tenant role, and no other', () => {
    const grants = [assigned({ permissionKeys: ['identity.accounts.view'] })];
    expect(holdsEveryKey(['identity.accounts.view'], grants, 'tenant-staff', scopeOf)).toBe(true);
    expect(
      holdsEveryKey(
        ['identity.accounts.view', 'identity.accounts.manage'],
        grants,
        'tenant-staff',
        scopeOf,
      ),
    ).toBe(false);
  });

  it('holds every tenant and site key through a system tenant role, never a platform key', () => {
    const grants = [assigned({ roleKind: 'system' })];
    for (const key of ['identity.accounts.manage', 'content.items.edit']) {
      expect(holdsEveryKey([key], grants, 'tenant-staff', scopeOf)).toBe(true);
    }
    expect(holdsEveryKey(['platform.tenants.manage'], grants, 'tenant-staff', scopeOf)).toBe(false);
  });

  it('confers site keys only through a site role, somewhere in the tenant', () => {
    const site = assigned({
      level: 'site',
      roleScope: 'site',
      siteId: '01990000-0000-7000-8000-000000000009' as never,
      permissionKeys: ['content.items.edit', 'identity.accounts.view'],
    });
    expect(holdsEveryKey(['content.items.edit'], [site], 'tenant-staff', scopeOf)).toBe(true);
    expect(holdsEveryKey(['identity.accounts.view'], [site], 'tenant-staff', scopeOf)).toBe(false);
  });

  it('grants nothing for an unknown key, an empty rule or a grant off its role level', () => {
    const system = [assigned({ roleKind: 'system' })];
    expect(holdsEveryKey(['unknown.key.x'], system, 'tenant-staff', scopeOf)).toBe(false);
    expect(holdsEveryKey([], system, 'tenant-staff', scopeOf)).toBe(false);
    const misplaced = [assigned({ roleKind: 'system', level: 'site' })];
    expect(holdsEveryKey(['identity.accounts.view'], misplaced, 'tenant-staff', scopeOf)).toBe(
      false,
    );
  });

  it('gives a portal user nothing and a platform operator only platform roles', () => {
    const tenantSystem = [assigned({ roleKind: 'system' })];
    expect(holdsEveryKey(['identity.accounts.view'], tenantSystem, 'portal-user', scopeOf)).toBe(
      false,
    );
    expect(
      holdsEveryKey(['identity.accounts.view'], tenantSystem, 'platform-operator', scopeOf),
    ).toBe(false);
    const platform = [assigned({ roleKind: 'system', level: 'platform', roleScope: 'platform' })];
    expect(holdsEveryKey(['platform.tenants.manage'], platform, 'platform-operator', scopeOf)).toBe(
      true,
    );
  });
});
