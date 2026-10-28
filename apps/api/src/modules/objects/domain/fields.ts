import { ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { invalid, parseKey, parseName, type InvalidValue } from './values';

// The fields of an Object revision (ADR-0017 decision 3). Each has a stable id: field rules
// (ADR-0024), stored values and the audit log key on it, never on the API key, so renaming a
// field keeps its rules and its values.

export const FIELD_TYPES = [
  'text',
  'long-text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'date-time',
  'choice',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** What a portal user may do with a field (ADR-0024 decision 9); absent is hidden. */
export const PORTAL_MODES = ['hidden', 'read', 'edit'] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/** The most fields one revision may have (also the longest list an audit value holds). */
export const MAX_FIELDS = 128;
export const MAX_OPTIONS = 100;
/** The longest text value, by type; a field may set a lower `maxLength`. */
export const TEXT_LIMITS: Readonly<Record<'text' | 'long-text', number>> = Object.freeze({
  text: 1000,
  'long-text': 10000,
});

export interface ChoiceOption {
  readonly key: string;
  readonly label: string;
}

export interface ObjectField {
  /** UUIDv7, minted when the field first appears; kept across revisions and renames. */
  readonly id: Id<'Field'>;
  /** The field's name in the generated API; unique in the revision. */
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  /**
   * Hidden from staff until a role's field rule opens it, and sealed under the record's
   * subject key (ADR-0024 decision 4). True unless the designer says otherwise when the field
   * first appears; lowering it later needs `objects.definitions.lower-sensitivity`.
   */
  readonly sensitive: boolean;
  readonly portal?: Exclude<PortalMode, 'hidden'>;
  /** `choice` only: the closed option keys and their labels. */
  readonly options?: readonly ChoiceOption[];
  /** `text` and `long-text` only. */
  readonly maxLength?: number;
}

/** The designer's description of one field; `id` names a field of the previous revision. */
export interface FieldInput {
  readonly id?: Id<'Field'>;
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly portal?: string;
  readonly options?: readonly { readonly key: string; readonly label: string }[];
  readonly maxLength?: number;
}

export interface AssignedFields {
  readonly fields: readonly ObjectField[];
  /** Fields that were sensitive in the previous revision and are not any more. */
  readonly lowered: readonly Id<'Field'>[];
}

/**
 * The fields of a new revision, given the previous revision's (`null` for the first):
 *
 * 1. an input's `id` must name a field of the previous revision, once (a rename);
 * 2. any other input takes the id its key had in the previous revision, unless step 1 gave
 *    that id to another input;
 * 3. every other input gets a new id from `mint`.
 *
 * A kept field keeps its type (stored values stay valid). `sensitive` and `portal` follow the
 * input, else the previous field, else sensitive and hidden.
 */
export function assignFields(
  inputs: readonly FieldInput[],
  previous: readonly ObjectField[] | null,
  mint: () => Id<'Field'>,
): Result<AssignedFields, InvalidValue> {
  if (inputs.length === 0 || inputs.length > MAX_FIELDS) return invalid('fields');
  const before = previous ?? [];
  const byId = new Map(before.map((field) => [field.id as string, field]));
  const byKey = new Map(before.map((field) => [field.key, field]));
  const keys = new Set<string>();
  const claimed = new Set<string>();
  for (const input of inputs) {
    if (keys.has(input.key)) return invalid('fields');
    keys.add(input.key);
    if (input.id === undefined) continue;
    if (!byId.has(input.id) || claimed.has(input.id)) return invalid('fields');
    claimed.add(input.id);
  }

  const fields: ObjectField[] = [];
  const lowered: Id<'Field'>[] = [];
  for (const input of inputs) {
    let prior: ObjectField | undefined;
    if (input.id !== undefined) prior = byId.get(input.id);
    else {
      const sameKey = byKey.get(input.key);
      if (sameKey !== undefined && !claimed.has(sameKey.id)) prior = sameKey;
    }
    const field = parseField(input, prior, mint);
    if (!field.ok) return field;
    if (prior?.sensitive === true && !field.value.sensitive) lowered.push(field.value.id);
    fields.push(field.value);
  }
  return ok({ fields, lowered });
}

function parseField(
  input: FieldInput,
  prior: ObjectField | undefined,
  mint: () => Id<'Field'>,
): Result<ObjectField, InvalidValue> {
  const key = parseKey(input.key, 'fields');
  if (!key.ok) return key;
  const label = parseName(input.label, 'fields');
  if (!label.ok) return label;
  const type = input.type as FieldType;
  if (!(FIELD_TYPES as readonly string[]).includes(type)) return invalid('fields');
  if (prior !== undefined && prior.type !== type) return invalid('fields');
  const portal = input.portal ?? prior?.portal ?? 'hidden';
  if (!(PORTAL_MODES as readonly string[]).includes(portal)) return invalid('fields');
  const field: ObjectField = {
    id: prior?.id ?? mint(),
    key: key.value,
    label: label.value,
    type,
    required: input.required ?? false,
    sensitive: input.sensitive ?? prior?.sensitive ?? true,
    ...(portal === 'hidden' ? {} : { portal: portal as 'read' | 'edit' }),
  };
  if (type === 'choice') {
    const options = parseOptions(input.options);
    if (!options.ok) return options;
    if (input.maxLength !== undefined) return invalid('fields');
    return ok({ ...field, options: options.value });
  }
  if (input.options !== undefined) return invalid('fields');
  if (type === 'text' || type === 'long-text') {
    const limit = TEXT_LIMITS[type];
    const maxLength = input.maxLength ?? limit;
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > limit) {
      return invalid('fields');
    }
    return ok({ ...field, maxLength });
  }
  return input.maxLength === undefined ? ok(field) : invalid('fields');
}

function parseOptions(
  options: FieldInput['options'],
): Result<readonly ChoiceOption[], InvalidValue> {
  if (options === undefined || options.length === 0 || options.length > MAX_OPTIONS) {
    return invalid('fields');
  }
  const seen = new Set<string>();
  const parsed: ChoiceOption[] = [];
  for (const option of options) {
    const key = parseKey(option.key, 'fields');
    const label = parseName(option.label, 'fields');
    if (!key.ok || !label.ok || seen.has(key.value)) return invalid('fields');
    seen.add(key.value);
    parsed.push({ key: key.value, label: label.value });
  }
  return ok(parsed);
}

/**
 * Reads a stored field list back; `null` when it does not have the stored shape (never
 * trusted as fields).
 */
export function fieldsOf(stored: unknown): readonly ObjectField[] | null {
  if (!Array.isArray(stored)) return null;
  const fields: ObjectField[] = [];
  for (const item of stored as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, key, label, type, required, sensitive, portal, options, maxLength } =
      item as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      typeof key !== 'string' ||
      typeof label !== 'string' ||
      !(FIELD_TYPES as readonly unknown[]).includes(type) ||
      typeof required !== 'boolean' ||
      typeof sensitive !== 'boolean' ||
      (portal !== undefined && portal !== 'read' && portal !== 'edit') ||
      (maxLength !== undefined && typeof maxLength !== 'number')
    ) {
      return null;
    }
    let parsedOptions: ChoiceOption[] | undefined;
    if (options !== undefined) {
      if (!Array.isArray(options)) return null;
      parsedOptions = [];
      for (const option of options as unknown[]) {
        const { key: optionKey, label: optionLabel } = (option ?? {}) as Record<string, unknown>;
        if (typeof optionKey !== 'string' || typeof optionLabel !== 'string') return null;
        parsedOptions.push({ key: optionKey, label: optionLabel });
      }
    }
    fields.push({
      id: id as Id<'Field'>,
      key,
      label,
      type: type as FieldType,
      required,
      sensitive,
      ...(portal === undefined ? {} : { portal }),
      ...(parsedOptions === undefined ? {} : { options: parsedOptions }),
      ...(maxLength === undefined ? {} : { maxLength }),
    });
  }
  return fields;
}
