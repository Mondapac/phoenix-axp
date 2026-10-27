import { TEST_TENANTS } from '../../../../test/support/test-config';
import type { Id } from '@phoenix/shared-kernel';
import {
  MAX_FIELD_RULES,
  MAX_ROLE_PERMISSION_KEYS,
  MAX_ROLE_QUALIFIER_DEFINITIONS,
  parseFieldRules,
  parseQualifierDefinitions,
  parseRoleKey,
  parseRolePermissionKeys,
} from './role';

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

describe.each(TEST_TENANTS)('the field-access values of a role (tenant %s)', () => {
  const id = <K extends string>(n: number) =>
    `01990000-0000-7000-8000-${String(n).padStart(12, '0')}` as Id<K>;

  it('stores qualifier definitions sorted, and refuses none, duplicates and too many', () => {
    expect(parseQualifierDefinitions([id(2), id(1)])).toEqual({ ok: true, value: [id(1), id(2)] });
    const invalid = {
      ok: false,
      error: { code: 'identity.value.invalid', field: 'definitionIds' },
    };
    expect(parseQualifierDefinitions([])).toEqual(invalid);
    expect(parseQualifierDefinitions([id(1), id(1)])).toEqual(invalid);
    const many = Array.from({ length: MAX_ROLE_QUALIFIER_DEFINITIONS + 1 }, (_, n) =>
      id<'Definition'>(n),
    );
    expect(parseQualifierDefinitions(many)).toEqual(invalid);
  });

  it('stores field rules sorted by field, accepts none, and refuses a repeated field or mode', () => {
    expect(
      parseFieldRules([
        { fieldId: id(2), mode: 'edit' },
        { fieldId: id(1), mode: 'hidden' },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { fieldId: id(1), mode: 'hidden' },
        { fieldId: id(2), mode: 'edit' },
      ],
    });
    expect(parseFieldRules([])).toEqual({ ok: true, value: [] });
    const invalid = { ok: false, error: { code: 'identity.value.invalid', field: 'fieldRules' } };
    expect(
      parseFieldRules([
        { fieldId: id(1), mode: 'read' },
        { fieldId: id(1), mode: 'edit' },
      ]),
    ).toEqual(invalid);
    expect(parseFieldRules([{ fieldId: id(1), mode: 'write' as never }])).toEqual(invalid);
    const many = Array.from({ length: MAX_FIELD_RULES + 1 }, (_, n) => ({
      fieldId: id<'Field'>(n),
      mode: 'read' as const,
    }));
    expect(parseFieldRules(many)).toEqual(invalid);
  });
});
