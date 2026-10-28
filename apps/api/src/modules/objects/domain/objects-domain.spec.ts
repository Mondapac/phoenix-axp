import { describeAuditAction } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { OBJECTS_AUDIT_ACTIONS } from './audit-actions';
import { assignFields, fieldsOf, type FieldInput, type ObjectField } from './fields';
import { planPublish, planRetire } from './lifecycle';
import {
  applyChanges,
  latinDigits,
  parseChanges,
  parseValue,
  payloadFieldIds,
  type StoredValue,
  valuesFromJson,
  valuesToJson,
} from './record-values';
import { parseKey, parseName } from './values';

const id = (n: number) =>
  `01890a5d-ac96-774b-bcce-b3020000${String(n).padStart(4, '0')}` as Id<'Field'>;
const REVISION_1 = '01890a5d-ac96-774b-bcce-b302099a8061' as Id<'ObjectRevision'>;
const REVISION_2 = '01890a5d-ac96-774b-bcce-b302099a8062' as Id<'ObjectRevision'>;

const minter = (start = 100) => {
  let next = start;
  return () => id(next++);
};

const NAME: FieldInput = {
  key: 'name',
  label: 'نام',
  type: 'text',
  required: true,
  sensitive: false,
};
const NATIONAL_ID: FieldInput = { key: 'national-id', label: 'کد ملی', type: 'text' };
const STATUS: FieldInput = {
  key: 'status',
  label: 'وضعیت',
  type: 'choice',
  sensitive: false,
  options: [
    { key: 'open', label: 'باز' },
    { key: 'closed', label: 'بسته' },
  ],
};

describe('objects values', () => {
  it('accepts slug keys and refuses others', () => {
    expect(parseKey('contracts')).toEqual({ ok: true, value: 'contracts' });
    for (const key of ['', 'Contracts', 'a_b', '-a', 'قرارداد', 'x'.repeat(65)]) {
      expect(parseKey(key)).toEqual({
        ok: false,
        error: { code: 'objects.value.invalid', field: 'key' },
      });
    }
  });

  it('trims a name and refuses an empty or control-character one', () => {
    expect(parseName('  قراردادها ')).toEqual({ ok: true, value: 'قراردادها' });
    for (const name of ['', '  ', 'a\nb', 'x'.repeat(201)]) expect(parseName(name).ok).toBe(false);
  });
});

describe('assigning field ids', () => {
  it('mints ids for a first revision; a field is sensitive unless said otherwise', () => {
    const assigned = assignFields([NAME, NATIONAL_ID, STATUS], null, minter());
    expect(assigned.ok && assigned.value.fields.map((f) => [f.id, f.key, f.sensitive])).toEqual([
      [id(100), 'name', false],
      [id(101), 'national-id', true],
      [id(102), 'status', false],
    ]);
    expect(assigned.ok && assigned.value.fields[0]).toMatchObject({ maxLength: 1000 });
  });

  it('keeps an id by key, by explicit id on a rename, and reports lowered sensitivity', () => {
    const first = assignFields([NAME, NATIONAL_ID], null, minter());
    if (!first.ok) throw new Error('setup');
    const previous = first.value.fields;
    const next = assignFields(
      [
        { ...NAME, key: 'full-name', id: id(100) },
        { ...NATIONAL_ID, sensitive: false },
        { key: 'name', label: 'تازه', type: 'boolean' },
      ],
      previous,
      minter(200),
    );
    expect(next.ok && next.value.fields.map((f) => [f.id, f.key])).toEqual([
      [id(100), 'full-name'],
      [id(101), 'national-id'],
      // `name` was claimed by the rename, so a new field of that key gets a new id.
      [id(200), 'name'],
    ]);
    expect(next.ok && next.value.lowered).toEqual([id(101)]);
  });

  it('refuses duplicate keys, unknown or repeated ids, type changes and bad options', () => {
    const first = assignFields([NAME, STATUS], null, minter());
    if (!first.ok) throw new Error('setup');
    const previous = first.value.fields;
    const bad: FieldInput[][] = [
      [],
      [NAME, NAME],
      [{ ...NAME, id: id(999) }],
      [
        { ...NAME, id: id(100) },
        { ...STATUS, id: id(100) },
      ],
      [{ ...NAME, type: 'integer' }],
      [{ ...STATUS, options: [] }],
      [
        {
          ...STATUS,
          options: [
            { key: 'a', label: 'x' },
            { key: 'a', label: 'y' },
          ],
        },
      ],
      [{ ...NAME, options: [{ key: 'a', label: 'x' }] }],
      [{ ...NAME, maxLength: 1001 }],
      [{ key: 'n', label: 'n', type: 'integer', maxLength: 3 }],
      [{ key: 'n', label: 'n', type: 'file' }],
      [{ ...NAME, portal: 'admin' }],
    ];
    for (const inputs of bad) {
      expect(assignFields(inputs, previous, minter(300))).toEqual({
        ok: false,
        error: { code: 'objects.value.invalid', field: 'fields' },
      });
    }
  });

  it('reads stored fields back and never trusts another shape', () => {
    const assigned = assignFields([NAME, STATUS], null, minter());
    if (!assigned.ok) throw new Error('setup');
    const stored = JSON.parse(JSON.stringify(assigned.value.fields)) as unknown;
    expect(fieldsOf(stored)).toEqual(assigned.value.fields);
    expect(fieldsOf(null)).toBeNull();
    expect(fieldsOf([{ id: 'x', key: 'k' }])).toBeNull();
  });
});

describe('record values', () => {
  const fields = (() => {
    const assigned = assignFields(
      [
        NAME,
        STATUS,
        { key: 'count', label: 'تعداد', type: 'integer', sensitive: false },
        { key: 'amount', label: 'مبلغ', type: 'decimal', sensitive: false },
        { key: 'signed', label: 'امضا', type: 'boolean', sensitive: false },
        { key: 'start', label: 'شروع', type: 'date', sensitive: false },
        { key: 'at', label: 'زمان', type: 'date-time', sensitive: false },
        { key: 'note', label: 'یادداشت', type: 'long-text', maxLength: 5, sensitive: false },
      ],
      null,
      minter(),
    );
    if (!assigned.ok) throw new Error('setup');
    return assigned.value.fields;
  })();
  const field = (key: string): ObjectField => fields.find((f) => f.key === key)!;

  it('parses each type to one stored form, Persian digits included (ADR-0008)', () => {
    expect(latinDigits('۱۴۰۵-۰۸-۰۶')).toBe('1405-08-06');
    expect(parseValue(field('count'), '۴۲')).toBe(42);
    expect(parseValue(field('count'), 7)).toBe(7);
    expect(parseValue(field('amount'), '۰۱۲٫۵۰')).toBe('12.5');
    expect(parseValue(field('amount'), -0.25)).toBe('-0.25');
    expect(parseValue(field('amount'), '-0.0')).toBe('0');
    expect(parseValue(field('signed'), true)).toBe(true);
    expect(parseValue(field('start'), '2026-10-28')).toBe('2026-10-28');
    expect(parseValue(field('at'), '2026-10-28T10:00:00+03:30')).toBe('2026-10-28T06:30:00Z');
    expect(parseValue(field('status'), 'open')).toBe('open');
    expect(parseValue(field('note'), 'a\nb')).toBe('a\nb');
  });

  it('refuses values that do not fit', () => {
    const refused: [string, unknown][] = [
      ['name', 42],
      ['name', 'a\u0000b'],
      ['name', 'a\nb'],
      ['note', 'toolong'],
      ['count', 1.5],
      ['count', '12a'],
      ['count', 2 ** 60],
      ['amount', 1e21],
      ['amount', 'abc'],
      ['signed', 'true'],
      ['start', '2026-02-30'],
      ['start', '1405/08/06'],
      ['at', '2026-10-28T10:00:00'],
      ['status', 'other'],
    ];
    for (const [key, raw] of refused) expect(parseValue(field(key), raw)).toBeUndefined();
  });

  it('maps unknown payload keys to no field, so the write check refuses them', () => {
    expect(payloadFieldIds(fields, { name: 'x', secret: 1 })).toEqual([
      field('name').id,
      'unknown:secret',
    ]);
  });

  it('applies changes: null clears, dropped fields go, required fields must hold a value', () => {
    const changes = parseChanges(fields, { name: 'Sara', count: '3', signed: null });
    expect(changes.ok).toBe(true);
    if (!changes.ok) return;
    const current = new Map<Id<'Field'>, StoredValue>([
      [field('signed').id, true],
      [id(999), 'from a removed field'],
    ]);
    const next = applyChanges(fields, current, changes.value, () => true, false);
    expect(next.ok && valuesToJson(next.value)).toEqual({
      [field('name').id]: 'Sara',
      [field('count').id]: 3,
    });
    expect(parseChanges(fields, { count: 'x' })).toEqual({
      ok: false,
      error: { code: 'objects.record.invalid', field: 'count' },
    });
    const missing = parseChanges(fields, { count: 1 });
    if (!missing.ok) throw new Error('setup');
    expect(applyChanges(fields, new Map(), missing.value, () => true, false)).toEqual({
      ok: false,
      error: { code: 'objects.record.invalid', field: 'name' },
    });
    // On create a required field the writer cannot edit is refused but never named.
    expect(applyChanges(fields, new Map(), missing.value, () => false, true)).toEqual({
      ok: false,
      error: { code: 'objects.record.invalid' },
    });
    // On update it is not checked, so no refusal tells whether it is empty.
    expect(applyChanges(fields, new Map(), missing.value, () => false, false).ok).toBe(true);
  });

  it('round-trips stored JSON and drops anything that is not a stored value', () => {
    const values = new Map([[field('count').id, 3]]);
    expect(valuesFromJson(valuesToJson(values))).toEqual(values);
    expect(valuesFromJson({ a: { nested: 1 }, b: null, c: 'x' })).toEqual(new Map([['c', 'x']]));
    expect(valuesFromJson('nope')).toEqual(new Map());
  });
});

describe('the life of a definition', () => {
  it('publishes any revision but the served one, and retires only a published definition', () => {
    const draft = { status: 'draft', publishedRevisionId: null } as const;
    const published = planPublish(draft, REVISION_1);
    expect(published).toEqual({
      ok: true,
      value: { status: 'published', publishedRevisionId: REVISION_1 },
    });
    if (!published.ok) return;
    expect(planPublish(published.value, REVISION_1)).toEqual({
      ok: false,
      error: { code: 'objects.definition.already-published' },
    });
    expect(planPublish(published.value, REVISION_2).ok).toBe(true);
    const retired = planRetire(published.value);
    expect(retired).toEqual({
      ok: true,
      value: { status: 'retired', publishedRevisionId: REVISION_1 },
    });
    expect(planRetire(draft).ok).toBe(false);
    if (retired.ok) expect(planPublish(retired.value, REVISION_1).ok).toBe(true);
  });
});

describe('the audit actions of the objects module', () => {
  it('describe every action with closed fields only', () => {
    expect(OBJECTS_AUDIT_ACTIONS.map((d) => describeAuditAction(d).action)).toEqual(
      OBJECTS_AUDIT_ACTIONS.map((d) => d.action),
    );
  });
});
