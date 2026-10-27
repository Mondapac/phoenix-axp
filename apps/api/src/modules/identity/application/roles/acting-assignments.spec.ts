import { TEST_TENANTS } from '../../../../../test/support/test-config';
import { FIELD_MODES, MAX_QUALIFIER_DEFINITIONS } from '../../../../platform/authz';
import { MAX_ROLE_QUALIFIER_DEFINITIONS, ROLE_FIELD_MODES } from '../../domain/role';
import {
  definitionAccessOf,
  effectiveKeysOf,
  grantingActorsOf,
  heldKeysOf,
  keyFitsRole,
} from './acting-assignments';
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

describe.each(TEST_TENANTS)('definition access of a role (tenant %s)', () => {
  const READ = 'records.item.read';
  const UPDATE = 'records.item.update';
  const DEF = testId<'Definition'>();
  const FIELD = testId<'Field'>();

  it('repeats the field modes and qualifier bound of platform/authz in the domain', () => {
    expect(ROLE_FIELD_MODES).toEqual(FIELD_MODES);
    expect(MAX_ROLE_QUALIFIER_DEFINITIONS).toBe(MAX_QUALIFIER_DEFINITIONS);
  });

  it('gives a system role every definition for each qualified key, and no rule', () => {
    const access = definitionAccessOf(testRole({ kind: 'system', scope: 'tenant' }), testCatalogue);
    expect([...access.qualifiers.keys()].sort()).toEqual([READ, UPDATE]);
    expect(access.qualifiers.get(READ)).toEqual({ all: true });
    expect(access.fieldRules.size).toBe(0);
  });

  it("keeps a custom role's stored qualifiers of keys it confers that are still qualified", () => {
    const role = testRole({
      scope: 'site',
      permissionKeys: [READ, 'content.items.edit'],
      definitionScopes: [
        { permissionKey: READ, allDefinitions: false, definitionIds: [DEF] },
        { permissionKey: UPDATE, allDefinitions: true, definitionIds: [] },
        { permissionKey: 'content.items.edit', allDefinitions: true, definitionIds: [] },
      ],
      fieldRules: [{ definitionId: DEF, fieldId: FIELD, mode: 'hidden' }],
    });
    const access = definitionAccessOf(role, testCatalogue);
    expect([...access.qualifiers.keys()]).toEqual([READ]);
    expect(access.qualifiers.get(READ)).toEqual({ all: false, definitionIds: new Set([DEF]) });
    expect(access.fieldRules.get(DEF)?.get(FIELD)).toBe('hidden');
  });

  it('hands the acting grant its role definition access', () => {
    const role = testRole({
      permissionKeys: ['identity.role-assignments.manage', READ],
      definitionScopes: [{ permissionKey: READ, allDefinitions: true, definitionIds: [] }],
    });
    const grant = testGrant(role);
    const [actor] = grantingActorsOf(
      grant.accountId,
      'tenant-staff',
      [grant],
      MANAGE,
      testCatalogue,
    );
    expect(actor?.definitionAccess?.qualifiers.get(READ)).toEqual({ all: true });
  });
});
