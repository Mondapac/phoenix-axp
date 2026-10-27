// Phoenix ADR-0004 decision 7 with ADR-0018 decision 6 and ADR-0019: which population holds
// which role scope, and which permission scopes a role of each scope may hold.
import { POPULATIONS } from '@phoenix/shared-kernel';
import { PERMISSION_SCOPES, populationOfScope } from '../permission';
import {
  grantFitsRole,
  permissionScopesOfRole,
  populationOfRoleScope,
  ROLE_SCOPES,
  roleScopesOf,
} from './role-model';

describe('the role model', () => {
  it('gives a portal user no role scope at all', () => {
    expect(roleScopesOf('portal-user')).toEqual([]);
    expect(roleScopesOf('platform-operator')).toEqual(['platform']);
    expect(roleScopesOf('tenant-staff')).toEqual(['tenant', 'site']);
  });

  it.each(POPULATIONS)(
    'keeps roleScopesOf(%s) and populationOfRoleScope consistent',
    (population) => {
      for (const scope of roleScopesOf(population)) {
        expect(populationOfRoleScope(scope)).toBe(population);
      }
    },
  );

  it.each(ROLE_SCOPES)('lets a %s role hold only keys of its own population', (scope) => {
    for (const keyScope of permissionScopesOfRole(scope)) {
      expect(populationOfScope(keyScope)).toBe(populationOfRoleScope(scope));
    }
  });

  it('lets a site role hold site keys only, and a tenant role tenant and site keys', () => {
    expect(permissionScopesOfRole('site')).toEqual(['site']);
    expect(permissionScopesOfRole('tenant')).toEqual(['tenant', 'site']);
    expect(permissionScopesOfRole('platform')).toEqual(['platform']);
    expect(new Set(ROLE_SCOPES.flatMap(permissionScopesOfRole))).toEqual(
      new Set(PERMISSION_SCOPES),
    );
  });

  it('places a grant at its role level', () => {
    expect(grantFitsRole({ level: 'tenant' }, 'tenant')).toBe(true);
    expect(grantFitsRole({ level: 'tenant' }, 'site')).toBe(false);
    expect(grantFitsRole({ level: 'platform' }, 'tenant')).toBe(false);
  });
});
