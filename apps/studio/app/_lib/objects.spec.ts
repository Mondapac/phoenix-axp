import {
  changesOf,
  checkDrafts,
  displayValue,
  draftOf,
  inputText,
  isKey,
  listColumns,
  moveDraft,
  newDraft,
  revisionBody,
  subtreeOf,
  valueOf,
  zonedEpochMs,
  type DescribedField,
  type FieldDraft,
} from './objects';

// Two tenants with different locale, calendar and time zone (CLAUDE.md rule 5).
const TENANTS = [
  { locale: 'fa-IR', calendar: 'persian', timeZone: 'Asia/Tehran' },
  { locale: 'en-CA', calendar: 'gregory', timeZone: 'America/Toronto' },
] as const;
const WORDS = { yes: 'Y', no: 'N' };

const described = (type: DescribedField['type'], extra: Partial<DescribedField> = {}) => ({
  key: type,
  label: type,
  type,
  required: false,
  read: true,
  create: true,
  update: true,
  ...extra,
});

describe('isKey', () => {
  it('takes hyphenated lower-case words and refuses anything else', () => {
    expect(isKey('national-id')).toBe(true);
    expect(isKey('a1')).toBe(true);
    for (const bad of ['', 'A', 'a--b', '-a', 'a-', 'a_b', 'کد', 'a'.repeat(65)]) {
      expect([bad, isKey(bad)]).toEqual([bad, false]);
    }
  });
});

describe('checkDrafts', () => {
  const draft = (over: Partial<FieldDraft>): FieldDraft => ({
    ...newDraft(),
    key: 'title',
    label: 'عنوان',
    ...over,
  });

  it('accepts a valid list and points at the first broken part', () => {
    expect(checkDrafts([draft({})])).toBeNull();
    expect(checkDrafts([])).toEqual({ index: -1, part: 'key' });
    expect(checkDrafts([draft({}), draft({})])).toEqual({ index: 1, part: 'key' });
    expect(checkDrafts([draft({ label: '  ' })])).toEqual({ index: 0, part: 'label' });
    expect(checkDrafts([draft({ type: 'choice' })])).toEqual({ index: 0, part: 'options' });
    expect(
      checkDrafts([
        draft({
          type: 'choice',
          options: [
            { key: 'a', label: 'A' },
            { key: 'a', label: 'B' },
          ],
        }),
      ]),
    ).toEqual({ index: 0, part: 'options' });
    expect(checkDrafts([draft({ maxLength: '1001' })])).toEqual({ index: 0, part: 'maxLength' });
    expect(checkDrafts([draft({ type: 'long-text', maxLength: '۵۰۰۰' })])).toBeNull();
  });
});

describe('revisionBody', () => {
  it('keeps the id of a kept field, the options of a choice and a set length only', () => {
    const kept = draftOf({
      id: 'f1',
      key: 'kind',
      label: ' نوع ',
      type: 'choice',
      required: true,
      sensitive: false,
      portal: 'read',
      options: [{ key: 'a', label: 'A' }],
    });
    const text = { ...newDraft(), key: 'note', label: 'Note', maxLength: '' };
    expect(revisionBody([kept, text]).fields).toEqual([
      {
        id: 'f1',
        key: 'kind',
        label: 'نوع',
        type: 'choice',
        required: true,
        sensitive: false,
        portal: 'read',
        options: [{ key: 'a', label: 'A' }],
      },
      {
        key: 'note',
        label: 'Note',
        type: 'text',
        required: false,
        sensitive: true,
        portal: 'hidden',
      },
    ]);
  });

  it('reads the type’s own limit back as an empty box', () => {
    const field = { id: 'f', key: 'k', label: 'L', required: false, sensitive: true } as const;
    expect(draftOf({ ...field, type: 'text', maxLength: 1000 }).maxLength).toBe('');
    expect(draftOf({ ...field, type: 'text', maxLength: 20 }).maxLength).toBe('20');
  });
});

describe('moveDraft', () => {
  it('swaps neighbours and stays inside the list', () => {
    expect(moveDraft(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveDraft(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe.each(TENANTS)('record values for $locale', (ctx) => {
  it('reads Persian digits and refuses what the API would', () => {
    expect(valueOf(described('integer'), '۱۲۳', ctx)).toBe(123);
    expect(valueOf(described('integer'), '1.5', ctx)).toBeUndefined();
    expect(valueOf(described('decimal'), '۱٫۵', ctx)).toBe('1.5');
    for (const [typed, stored] of [
      ['01.50', '1.5'],
      ['-0.0', '0'],
      ['7.', undefined],
    ] as const) {
      expect([typed, valueOf(described('decimal'), typed, ctx)]).toEqual([typed, stored]);
    }
    expect(valueOf(described('text'), '  ', ctx)).toBe('  ');
    expect(valueOf(described('text'), '', ctx)).toBeNull();
    expect(valueOf(described('text'), 'a\u0007b', ctx)).toBeUndefined();
    expect(valueOf(described('long-text'), 'a\nb', ctx)).toBe('a\nb');
    expect(valueOf(described('integer'), '  ', ctx)).toBeNull();
    expect(valueOf(described('text', { maxLength: 3 }), 'abcd', ctx)).toBeUndefined();
    expect(valueOf(described('boolean'), 'false', ctx)).toBe(false);
    const choice = described('choice', { options: [{ key: 'a', label: 'A' }] });
    expect(valueOf(choice, 'b', ctx)).toBeUndefined();
    expect(valueOf(choice, 'a', ctx)).toBe('a');
  });

  it('round-trips a date through the tenant’s calendar', () => {
    const date = described('date');
    const text = inputText(date, '2026-10-30', ctx);
    expect(text).toBe(ctx.calendar === 'persian' ? '1405/08/08' : '2026/10/30');
    expect(valueOf(date, text, ctx)).toBe('2026-10-30');
    expect(valueOf(date, '1405/13/01', ctx)).toBeUndefined();
    expect(valueOf(described('date-time'), '1405/13/40 10:00', ctx)).toBeUndefined();
  });

  it('round-trips an instant through the tenant’s time zone', () => {
    const at = described('date-time');
    const text = inputText(at, '2026-10-30T06:30:00.000Z', ctx);
    expect(text).toBe(ctx.timeZone === 'Asia/Tehran' ? '1405/08/08 10:00' : '2026/10/30 02:30');
    expect(valueOf(at, text, ctx)).toBe('2026-10-30T06:30:00.000Z');
    expect(valueOf(at, '2026/10/30 25:00', ctx)).toBeUndefined();
  });

  it('shows a stored value in the locale', () => {
    const shown = displayValue(described('integer'), 1234, ctx, WORDS);
    expect(shown).toBe(ctx.locale === 'fa-IR' ? '۱٬۲۳۴' : '1,234');
    expect(displayValue(described('boolean'), true, ctx, WORDS)).toBe('Y');
    // 21 significant digits: a float would round them.
    expect(displayValue(described('decimal'), '12345678901234567890.5', ctx, WORDS)).toBe(
      ctx.locale === 'fa-IR' ? '۱۲٬۳۴۵٬۶۷۸٬۹۰۱٬۲۳۴٬۵۶۷٬۸۹۰٫۵' : '12,345,678,901,234,567,890.5',
    );
    expect(displayValue(described('text'), undefined, ctx, WORDS)).toBe('');
  });
});

describe('zonedEpochMs', () => {
  it('takes the offset in force at that wall time (daylight saving)', () => {
    // Toronto is UTC-4 in October and UTC-5 in December.
    expect(new Date(zonedEpochMs('2026-10-30', 9, 0, 'America/Toronto')).toISOString()).toBe(
      '2026-10-30T13:00:00.000Z',
    );
    expect(new Date(zonedEpochMs('2026-12-01', 9, 0, 'America/Toronto')).toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
  });
});

describe('field access on the record screens', () => {
  const hidden = described('text', { key: 'secret', read: false, update: false, create: false });
  const viewOnly = described('text', { key: 'code', update: false });
  const editable = described('text', { key: 'name' });

  it('never makes a column of a field the member may not read', () => {
    expect(listColumns([hidden, viewOnly, editable]).map((f) => f.key)).toEqual(['code', 'name']);
  });

  it('sends only editable fields that changed', () => {
    const record = { code: 'A', name: 'x' };
    expect(changesOf([viewOnly, editable], record, { code: 'B', name: 'x', secret: 'z' })).toEqual(
      {},
    );
    expect(changesOf([viewOnly, editable], record, { name: null })).toEqual({ name: null });
  });
});

describe('subtreeOf', () => {
  it('takes the site and the deeper sites that follow it in tree order', () => {
    const sites = [
      { id: 'r', depth: 0 },
      { id: 'a', depth: 1 },
      { id: 'a1', depth: 2 },
      { id: 'b', depth: 1 },
    ];
    expect(subtreeOf(sites, 'a').map((s) => s.id)).toEqual(['a', 'a1']);
    expect(subtreeOf(sites, 'x')).toEqual([]);
  });
});
