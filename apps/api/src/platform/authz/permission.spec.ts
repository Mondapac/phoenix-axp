// Ported from Mondapac apps/api/src/platform/authz/permission.spec.ts. Phoenix: the scopes are
// platform, tenant and site (ADR-0018 decision 6), and a scope implies a population.
import {
  declarePermissions,
  definePermission,
  isPermissionCatalogue,
  MAX_PERMISSION_KEY_LENGTH,
  PermissionDeclarationError,
  populationOfScope,
} from './permission';

// platform-foundations design 6.1: one helper validates and brands the keys of a module.

describe('definePermission', () => {
  it('brands a key of the declaring module, with its scope and protection', () => {
    expect(
      definePermission('identity', {
        key: 'identity.tenant-access.view',
        scope: 'platform',
        protected: false,
      }),
    ).toEqual({ key: 'identity.tenant-access.view', scope: 'platform', protected: false });
  });

  it.each([
    ['a key of another module', { key: 'content.page.edit', scope: 'tenant', protected: false }],
    ['two segments', { key: 'identity.view', scope: 'platform', protected: false }],
    ['upper case', { key: 'identity.Tenant.view', scope: 'platform', protected: false }],
    ['a portal scope', { key: 'identity.order.view', scope: 'portal', protected: false }],
    [
      'an organisation scope',
      { key: 'identity.order.view', scope: 'organisation', protected: false },
    ],
    ['no protection stated', { key: 'identity.order.view', scope: 'platform' }],
    [
      'a key longer than MAX_PERMISSION_KEY_LENGTH',
      {
        key: `identity.${'a'.repeat(MAX_PERMISSION_KEY_LENGTH - 'identity..view'.length + 1)}.view`,
        scope: 'platform',
        protected: false,
      },
    ],
  ])('refuses %s', (_case, declaration) => {
    expect(() => definePermission('identity', declaration as never)).toThrow(
      PermissionDeclarationError,
    );
  });
});

describe('the key length cap: the stored column limit of 128 (slice 8a-1; Ali on Mohammad)', () => {
  it('accepts a key of exactly MAX_PERMISSION_KEY_LENGTH characters', () => {
    const key = `identity.${'a'.repeat(MAX_PERMISSION_KEY_LENGTH - 'identity..view'.length)}.view`;
    expect(key).toHaveLength(MAX_PERMISSION_KEY_LENGTH);
    expect(definePermission('identity', { key, scope: 'platform', protected: false }).key).toBe(
      key,
    );
  });
});

describe('declarePermissions', () => {
  const view = definePermission('identity', {
    key: 'identity.team-member.view',
    scope: 'tenant',
    protected: false,
  });

  it('makes a catalogue the CI check can recognise, and nothing else is one', () => {
    const catalogue = declarePermissions('identity', [view]);

    expect(isPermissionCatalogue(catalogue)).toBe(true);
    expect(isPermissionCatalogue({ ...catalogue })).toBe(false);
    expect(catalogue.declarations).toEqual([view]);
    expect(Object.isFrozen(catalogue)).toBe(true);
  });

  it('refuses a duplicate key and a declaration of another module', () => {
    expect(() => declarePermissions('identity', [view, view])).toThrow(/twice/);
    expect(() => declarePermissions('content', [view])).toThrow(PermissionDeclarationError);
  });
});

describe('populationOfScope: a scope names who may hold the key (ADR-0004 decision 7)', () => {
  it('maps platform to platform operators and tenant and site to tenant staff', () => {
    expect(populationOfScope('platform')).toBe('platform-operator');
    expect(populationOfScope('tenant')).toBe('tenant-staff');
    expect(populationOfScope('site')).toBe('tenant-staff');
  });

  it('accepts a site-scoped key', () => {
    expect(
      definePermission('content', { key: 'content.page.publish', scope: 'site', protected: false })
        .scope,
    ).toBe('site');
  });
});

describe('the definition qualifier of a key (ADR-0024 decision 2)', () => {
  it('keeps the qualifier of a key over run-time definitions, and none otherwise', () => {
    expect(
      definePermission('objects', {
        key: 'objects.record.read',
        scope: 'site',
        protected: false,
        qualifier: 'definition',
      }).qualifier,
    ).toBe('definition');
    expect(
      'qualifier' in
        definePermission('content', { key: 'content.page.edit', scope: 'site', protected: false }),
    ).toBe(false);
  });

  it('refuses an unknown qualifier and a qualified platform key', () => {
    expect(() =>
      definePermission('objects', {
        key: 'objects.record.read',
        scope: 'site',
        protected: false,
        qualifier: 'site' as never,
      }),
    ).toThrow('unknown qualifier');
    expect(() =>
      definePermission('objects', {
        key: 'objects.record.read',
        scope: 'platform',
        protected: false,
        qualifier: 'definition',
      }),
    ).toThrow('cannot be qualified');
  });
});
