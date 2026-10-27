import { Temporal } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { assignFields, fieldsOf, type FieldSettingInput } from './form-fields';
import { parseSubmissionPolicy, type SubmissionPolicy } from './form-settings';
import {
  channelOf,
  eraseAfterOf,
  formatTrackingCode,
  parseTrackingCode,
  type Submitter,
} from './submission';

// Slice 2.5's pure rules: stable field ids across revisions (ADR-0024), who may submit under a
// form's policy, the tracking code and the retention date.

const fieldId = (n: number) =>
  `01990000-0000-7000-8000-${String(n).padStart(12, '0')}` as Id<'Field'>;
function minter(start = 100) {
  let next = start;
  return () => fieldId(next++);
}

describe('assignFields', () => {
  const first = assignFields(['fullName', 'phone'], null, {}, minter());
  const rev1 = first.ok ? first.value.fields : [];

  it('mints an id per property, sensitive and hidden from the portal by default', () => {
    expect(rev1).toEqual([
      { id: fieldId(100), name: 'fullName', sensitive: true },
      { id: fieldId(101), name: 'phone', sensitive: true },
    ]);
  });

  it('keeps ids by name, and keeps an id across a rename named by the designer', () => {
    const next = assignFields(
      ['name', 'phone', 'city'],
      rev1,
      { name: { id: fieldId(100) } },
      minter(200),
    );
    expect(next.ok && next.value.fields).toEqual([
      { id: fieldId(100), name: 'name', sensitive: true },
      { id: fieldId(101), name: 'phone', sensitive: true },
      { id: fieldId(200), name: 'city', sensitive: true },
    ]);
  });

  it('gives a new id to a property whose old name was taken over by a rename', () => {
    // `phone` now names the old `fullName` field; the property called `fullName` is new.
    const next = assignFields(
      ['fullName', 'phone'],
      rev1,
      { phone: { id: fieldId(100) } },
      minter(300),
    );
    expect(next.ok && next.value.fields.map((field) => field.id)).toEqual([
      fieldId(300),
      fieldId(100),
    ]);
  });

  it('reports a field whose sensitivity is lowered, and keeps settings by default', () => {
    const lowered = assignFields(
      ['fullName', 'phone'],
      rev1,
      { phone: { sensitive: false, portal: 'read' } },
      minter(),
    );
    expect(lowered.ok && lowered.value.lowered).toEqual([fieldId(101)]);
    const fields = lowered.ok ? lowered.value.fields : [];
    const again = assignFields(['fullName', 'phone'], fields, {}, minter());
    expect(again.ok && again.value.fields[1]).toEqual({
      id: fieldId(101),
      name: 'phone',
      sensitive: false,
      portal: 'read',
    });
    expect(again.ok && again.value.lowered).toEqual([]);
  });

  it('lets a new field start not sensitive without counting as lowered', () => {
    const fresh = assignFields(['note'], null, { note: { sensitive: false } }, minter());
    expect(fresh.ok && fresh.value).toEqual({
      fields: [{ id: fieldId(100), name: 'note', sensitive: false }],
      lowered: [],
    });
  });

  it('refuses an unknown id, an id given twice, a setting for no property and a bad mode', () => {
    const bad = { code: 'forms.value.invalid', field: 'fields' };
    const cases: Readonly<Record<string, FieldSettingInput>>[] = [
      { fullName: { id: fieldId(999) } },
      { fullName: { id: fieldId(100) }, phone: { id: fieldId(100) } },
      { nothing: {} },
      { phone: { portal: 'write' } },
    ];
    for (const settings of cases) {
      expect(assignFields(['fullName', 'phone'], rev1, settings, minter())).toEqual({
        ok: false,
        error: bad,
      });
    }
  });

  it('reads stored fields back and refuses another shape', () => {
    expect(fieldsOf(rev1.map((field) => ({ ...field })))).toEqual(rev1);
    expect(fieldsOf(null)).toBeNull();
    expect(fieldsOf([{ id: 1, name: 'x', sensitive: true }])).toBeNull();
    expect(fieldsOf([{ id: fieldId(1), name: 'x', sensitive: true, portal: 'hidden' }])).toBeNull();
  });
});

describe('channelOf (the submission policy)', () => {
  const policy = (audience: string, extra: Partial<SubmissionPolicy> = {}): SubmissionPolicy => {
    const parsed = parseSubmissionPolicy({
      audience,
      roleIds: audience === 'staff-roles' ? [fieldId(7) as string as Id<'Role'>] : [],
      allowOnBehalf: false,
      ...extra,
    });
    if (!parsed.ok) throw new Error('bad policy');
    return parsed.value;
  };
  const anonymous: Submitter = { kind: 'anonymous' };
  const portal: Submitter = { kind: 'portal-user' };
  const staff: Submitter = { kind: 'staff', holdsListedRole: false };
  const roleHolder: Submitter = { kind: 'staff', holdsListedRole: true };
  const other: Submitter = { kind: 'other' };

  it.each([
    ['anyone', anonymous, 'anonymous'],
    ['anyone', portal, 'portal-user'],
    ['anyone', staff, 'staff'],
    ['portal-user', portal, 'portal-user'],
    ['staff', staff, 'staff'],
    ['staff-roles', roleHolder, 'staff'],
  ] as const)('%s admits %o through %s', (audience, submitter, channel) => {
    expect(channelOf(policy(audience), submitter)).toEqual({ ok: true, value: channel });
  });

  it.each([
    ['anyone', other],
    ['portal-user', anonymous],
    ['portal-user', staff],
    ['staff', anonymous],
    ['staff', portal],
    ['staff-roles', staff],
    ['staff-roles', portal],
  ] as const)('%s refuses %o', (audience, submitter) => {
    expect(channelOf(policy(audience), submitter)).toEqual({
      ok: false,
      error: { code: 'forms.submission.not-admitted' },
    });
  });
});

describe('tracking codes and retention', () => {
  it('formats 16 digits in four groups and reads back what a person types', () => {
    expect(formatTrackingCode('1234567890123456')).toBe('1234-5678-9012-3456');
    expect(parseTrackingCode('1234-5678-9012-3456')).toBe('1234567890123456');
    expect(parseTrackingCode('۱۲۳۴ ۵۶۷۸ ۹۰۱۲ ۳۴۵۶')).toBe('1234567890123456');
    expect(parseTrackingCode('١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦')).toBe('1234567890123456');
    expect(parseTrackingCode('1234‌5678‌9012‌3456')).toBe('1234567890123456');
  });

  it('refuses anything but 16 digits', () => {
    for (const code of ['', '123', '1234-5678-9012-345a', '12345678901234567', 'x'.repeat(65)]) {
      expect(parseTrackingCode(code)).toBeNull();
    }
  });

  it('keeps forever by default (D5) and erases after a fixed number of days', () => {
    const at = Temporal.Instant.from('2026-10-27T20:00:00Z');
    expect(eraseAfterOf({ kind: 'forever' }, at)).toBeNull();
    expect(eraseAfterOf({ kind: 'fixed', days: 30 }, at)?.toString()).toBe('2026-11-26T20:00:00Z');
  });
});
