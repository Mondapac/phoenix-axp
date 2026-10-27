import { TEST_TENANTS } from '../../../../../test/support/test-config';
import { canDefineRole } from './role-definition';
import {
  testCatalogue,
  testGrant,
  testId,
  testRole,
} from '../../../../../test/support/role-catalogue';

const MANAGE = 'identity.roles.manage';
const actor = { accountId: testId<'Account'>(), population: 'tenant-staff' as const };

describe.each(TEST_TENANTS)('canDefineRole (tenant %s)', () => {
  it('lets a system role holder define any staff key, protected ones included', () => {
    const grants = [testGrant(testRole({ kind: 'system' }))];
    expect(
      canDefineRole(actor, grants, MANAGE, ['identity.accounts.manage'], testCatalogue).ok,
    ).toBe(true);
  });

  it('refuses a key the author does not hold, and a protected key without the system role', () => {
    const grants = [
      testGrant(
        testRole({
          permissionKeys: [MANAGE, 'identity.accounts.view', 'identity.accounts.manage'],
        }),
      ),
    ];
    expect(canDefineRole(actor, grants, MANAGE, ['content.items.edit'], testCatalogue)).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'keys-not-held' },
    });
    expect(
      canDefineRole(actor, grants, MANAGE, ['identity.accounts.manage'], testCatalogue),
    ).toEqual({ ok: false, error: { code: 'role.not-grantable', reason: 'protected-key' } });
    expect(canDefineRole(actor, grants, MANAGE, ['identity.accounts.view'], testCatalogue).ok).toBe(
      true,
    );
  });

  it('acts only under a tenant grant that confers the manage key', () => {
    // The keys are held, but under a grant without the manage key.
    const grants = [
      testGrant(testRole({ permissionKeys: [MANAGE] })),
      testGrant(testRole({ permissionKeys: ['identity.accounts.view'] })),
    ];
    expect(canDefineRole(actor, grants, MANAGE, ['identity.accounts.view'], testCatalogue)).toEqual(
      { ok: false, error: { code: 'role.not-grantable', reason: 'keys-not-held' } },
    );
  });
});
