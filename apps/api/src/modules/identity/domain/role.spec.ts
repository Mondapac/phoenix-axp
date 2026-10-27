import { TEST_TENANTS } from '../../../../test/support/test-config';
import { MAX_ROLE_PERMISSION_KEYS, parseRoleKey, parseRolePermissionKeys } from './role';

const INVALID_KEYS = {
  ok: false,
  error: { code: 'identity.value.invalid', field: 'permissionKeys' },
};

describe.each(TEST_TENANTS)('the role values (tenant %s)', () => {
  it.each([
    [' Site-Editor ', 'site-editor'],
    ['ab', 'ab'],
    ['x'.repeat(64), 'x'.repeat(64)],
  ])('accepts the key %p as %p', (raw, key) => {
    expect(parseRoleKey(raw)).toEqual({ ok: true, value: key });
  });

  it.each(['a', 'x'.repeat(65), 'site editor', '-site', 'site--editor', 'مدیر', 'site_editor'])(
    'refuses the key %p',
    (raw) => {
      expect(parseRoleKey(raw)).toEqual({
        ok: false,
        error: { code: 'identity.value.invalid', field: 'key' },
      });
    },
  );

  it('sorts the permission keys and checks each one', () => {
    expect(parseRolePermissionKeys(['b.c.d', 'a.b.c'], () => true)).toEqual({
      ok: true,
      value: ['a.b.c', 'b.c.d'],
    });
    expect(parseRolePermissionKeys(['a.b.c', 'x.y.z'], (k) => k === 'a.b.c')).toEqual(INVALID_KEYS);
  });

  it('refuses no keys, a duplicate and too many', () => {
    expect(parseRolePermissionKeys([], () => true)).toEqual(INVALID_KEYS);
    expect(parseRolePermissionKeys(['a.b.c', 'a.b.c'], () => true)).toEqual(INVALID_KEYS);
    const many = Array.from({ length: MAX_ROLE_PERMISSION_KEYS + 1 }, (_, n) => `a.b.c${n}`);
    expect(parseRolePermissionKeys(many, () => true)).toEqual(INVALID_KEYS);
  });
});
