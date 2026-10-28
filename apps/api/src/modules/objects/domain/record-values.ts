import { err, ok, Temporal } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import type { ObjectField } from './fields';

// The values of a record (ADR-0017 decision 4): keyed by field id in storage, by API key on the
// wire. Each type has one stored form, so equal values compare equal: integers as numbers,
// decimals as canonical strings, dates as ISO calendar dates, instants as UTC ISO strings.

export type StoredValue = string | number | boolean;

/** A record's values by field id; a field without a value is absent (never null). */
export type RecordValues = ReadonlyMap<Id<'Field'>, StoredValue>;

/**
 * A value that does not fit its field, or a required field left empty. `field` is the API key
 * of a field the writer may edit; a required field the writer cannot edit is never named
 * (ADR-0024 decision 7: no failure names a hidden field).
 */
export type InvalidRecord = { readonly code: 'objects.record.invalid'; readonly field?: string };

const invalidRecord = (field?: string): Result<never, InvalidRecord> =>
  err(
    field === undefined
      ? { code: 'objects.record.invalid' }
      : { code: 'objects.record.invalid', field },
  );

/**
 * The field ids of a payload keyed by API key, for `FieldPolicy.checkWrite`: an unknown key
 * maps to no field and is refused there like a hidden one, so a payload never learns which
 * keys exist.
 */
export function payloadFieldIds(
  fields: readonly ObjectField[],
  payload: Readonly<Record<string, unknown>>,
): string[] {
  const byKey = new Map(fields.map((field) => [field.key, field.id as string]));
  return Object.keys(payload).map((key) => byKey.get(key) ?? `unknown:${key}`);
}

/**
 * The changes of a payload whose every key is a field the writer may edit (checked first by
 * `FieldPolicy.checkWrite`): each value parsed to its stored form; `null` clears the field.
 */
export function parseChanges(
  fields: readonly ObjectField[],
  payload: Readonly<Record<string, unknown>>,
): Result<Map<Id<'Field'>, StoredValue | null>, InvalidRecord> {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const changes = new Map<Id<'Field'>, StoredValue | null>();
  for (const [key, raw] of Object.entries(payload)) {
    const field = byKey.get(key);
    if (field === undefined) return invalidRecord();
    if (raw === null) {
      changes.set(field.id, null);
      continue;
    }
    const value = parseValue(field, raw);
    if (value === undefined) return invalidRecord(field.key);
    changes.set(field.id, value);
  }
  return ok(changes);
}

/**
 * The record's values after `changes`, under `fields` (the revision it is written under):
 * values of fields the revision does not have are dropped, a cleared field is removed, and a
 * required field must hold a value. `editable` names the fields a failure may name. On create
 * (`requireAll`) every required field is checked: all start empty, so a refusal tells nothing.
 * On update only the editable ones are, so a refusal never tells whether a field the writer
 * cannot edit is empty (security review of slice 2.8, L2).
 */
export function applyChanges(
  fields: readonly ObjectField[],
  current: RecordValues,
  changes: ReadonlyMap<Id<'Field'>, StoredValue | null>,
  editable: (id: Id<'Field'>) => boolean,
  requireAll: boolean,
): Result<RecordValues, InvalidRecord> {
  const next = new Map<Id<'Field'>, StoredValue>();
  for (const field of fields) {
    const change = changes.get(field.id);
    const value = changes.has(field.id) ? change : current.get(field.id);
    if (value === null || value === undefined) {
      const named = editable(field.id);
      if (field.required && (requireAll || named)) {
        return invalidRecord(named ? field.key : undefined);
      }
      continue;
    }
    next.set(field.id, value);
  }
  return ok(next);
}

/** The stored form of `raw` for `field`, or `undefined` when it does not fit. */
export function parseValue(field: ObjectField, raw: unknown): StoredValue | undefined {
  switch (field.type) {
    case 'text':
    case 'long-text':
      return typeof raw === 'string' && fitsText(raw, field) ? raw : undefined;
    case 'integer':
      return parseInteger(raw);
    case 'decimal':
      return parseDecimal(raw);
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'date':
      return typeof raw === 'string' ? parseDate(raw) : undefined;
    case 'date-time':
      return typeof raw === 'string' ? parseInstant(raw) : undefined;
    case 'choice':
      return typeof raw === 'string' && field.options?.some((option) => option.key === raw)
        ? raw
        : undefined;
  }
}

function fitsText(text: string, field: ObjectField): boolean {
  const length = [...text].length;
  if (length > (field.maxLength ?? 0)) return false;
  // Control characters are refused; a long text may hold line breaks and tabs.
  for (const character of text) {
    const code = character.charCodeAt(0);
    const allowed = field.type === 'long-text' && (code === 0x0a || code === 0x09 || code === 0x0d);
    if ((code < 0x20 || code === 0x7f) && !allowed) return false;
  }
  return true;
}

/** Persian (U+06F0..) and Arabic-Indic (U+0660..) digits read as ASCII digits (ADR-0008). */
export function latinDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

const INTEGER = /^-?(0|[1-9]\d{0,15})$/;

function parseInteger(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = latinDigits(raw.trim());
  if (!INTEGER.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && !Object.is(value, -0) ? value : undefined;
}

/** Up to 20 digits before the point and 10 after. */
const DECIMAL = /^(-?)(\d{1,20})(?:\.(\d{1,10}))?$/;

function parseDecimal(raw: unknown): string | undefined {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined;
    text = String(raw);
    if (/e/i.test(text)) return undefined;
  } else if (typeof raw === 'string') {
    text = latinDigits(raw.trim()).replace('٫', '.');
  } else return undefined;
  const match = DECIMAL.exec(text);
  if (match === null) return undefined;
  const whole = match[2]!.replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const zero = whole === '0' && fraction === '';
  return `${match[1] === '-' && !zero ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(raw: string): string | undefined {
  const text = latinDigits(raw.trim());
  if (!DATE.test(text)) return undefined;
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString();
  } catch {
    return undefined;
  }
}

function parseInstant(raw: string): string | undefined {
  // An instant names its offset: a local date-time without one is ambiguous and refused.
  if (raw.length > 40) return undefined;
  try {
    return Temporal.Instant.from(raw.trim()).toString();
  } catch {
    return undefined;
  }
}

/** The stored values as JSON (by field id), for the `values` column or the sealed part. */
export function valuesToJson(values: RecordValues): Record<string, StoredValue> {
  return Object.fromEntries([...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Stored JSON back to values; anything that is not a stored value is dropped. */
export function valuesFromJson(stored: unknown): Map<Id<'Field'>, StoredValue> {
  const values = new Map<Id<'Field'>, StoredValue>();
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return values;
  for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values.set(id as Id<'Field'>, value);
    }
  }
  return values;
}
