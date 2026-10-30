import {
  formatDate,
  formatNumber,
  parseEditableText,
  toEditableText,
  toLocaleDigits,
} from '@phoenix/ui';

// The view of the objects API on the Object screens (ADR-0017, ADR-0024): the shapes the API
// answers and the pure rules the screens build on. The rules mirror
// `modules/objects/domain/{fields,values,record-values}.ts` only to point at the input the API
// would refuse; the API checks everything again. Shared by server and client modules.

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

export const PORTAL_MODES = ['hidden', 'read', 'edit'] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

export const DEFINITION_STATUSES = ['draft', 'published', 'retired'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export const MAX_FIELDS = 128;
export const MAX_OPTIONS = 100;
export const MAX_KEY_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
export const TEXT_LIMITS: Readonly<Record<'text' | 'long-text', number>> = {
  text: 1000,
  'long-text': 10000,
};

export interface ChoiceOption {
  readonly key: string;
  readonly label: string;
}

/** `GET objects/definitions` items and `definition` of `GET objects/definitions/:id`. */
export interface DefinitionView {
  readonly id: string;
  readonly siteId: string;
  readonly key: string;
  readonly name: string;
  readonly status: DefinitionStatus;
  readonly publishedRevisionId: string | null;
  /** The newest revision's number; 0 before the first. */
  readonly latestRevisionNumber: number;
  readonly version: number;
}

export interface RevisionSummary {
  readonly id: string;
  readonly definitionId: string;
  readonly number: number;
  readonly contentHash: string;
  readonly createdAt: string;
}

/** `GET objects/definitions/:id`: revisions newest first. */
export interface DefinitionDetail {
  readonly definition: DefinitionView;
  readonly revisions: readonly RevisionSummary[];
}

export interface FieldView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly portal?: 'read' | 'edit';
  readonly options?: readonly ChoiceOption[];
  readonly maxLength?: number;
}

/** `GET objects/revisions/:id`. */
export interface RevisionView extends RevisionSummary {
  readonly fields: readonly FieldView[];
}

/** A field of `GET objects/o/:key` as the member may use it at one site (ADR-0024). */
export interface DescribedField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly options?: readonly ChoiceOption[];
  readonly maxLength?: number;
  readonly read: boolean;
  readonly create: boolean;
  readonly update: boolean;
}

/** `GET objects/o/:key`: only the fields the member may read, create or update there. */
export interface ObjectDescription {
  readonly key: string;
  readonly name: string;
  readonly status: 'published' | 'retired';
  readonly siteId: string;
  readonly revisionNumber: number;
  readonly fields: readonly DescribedField[];
}

export type StoredValue = string | number | boolean;

export interface RecordView {
  readonly id: string;
  readonly siteId: string;
  readonly revisionNumber: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** By field key; a field the member may not read is absent. */
  readonly values: Readonly<Record<string, StoredValue>>;
}

export interface RecordPage {
  readonly items: readonly RecordView[];
  /** The `before` of the next (older) page. */
  readonly next: string | null;
}

// Keys and names (modules/objects/domain/values.ts).

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A definition's, field's or option's key: lower-case ASCII letters and digits, hyphenated. */
export const isKey = (text: string): boolean => text.length <= MAX_KEY_LENGTH && KEY.test(text);

const hasControl = (text: string) =>
  [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** A name or label: 1 to 200 characters once trimmed, no control characters. */
export function isName(text: string): boolean {
  const name = text.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && !hasControl(name);
}

// The field designer (modules/objects/domain/fields.ts).

/** One field as the designer edits it; `id` is set for a field kept from the last revision. */
export interface FieldDraft {
  readonly id?: string;
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly portal: PortalMode;
  readonly options: readonly ChoiceOption[];
  /** Text, so an empty box means the type's limit. */
  readonly maxLength: string;
  /** Whether the last revision marks it sensitive (lowering it needs its own key). */
  readonly wasSensitive: boolean;
}

export const draftOf = (field: FieldView): FieldDraft => ({
  id: field.id,
  key: field.key,
  label: field.label,
  type: field.type,
  required: field.required,
  sensitive: field.sensitive,
  portal: field.portal ?? 'hidden',
  options: field.options ?? [],
  // The type's own limit reads as an empty box.
  maxLength:
    hasLimit(field.type) &&
    field.maxLength !== undefined &&
    field.maxLength !== TEXT_LIMITS[field.type]
      ? String(field.maxLength)
      : '',
  wasSensitive: field.sensitive,
});

/** A new field: sensitive and hidden from portals until the designer says otherwise. */
export const newDraft = (): FieldDraft => ({
  key: '',
  label: '',
  type: 'text',
  required: false,
  sensitive: true,
  portal: 'hidden',
  options: [],
  maxLength: '',
  wasSensitive: false,
});

export const hasLimit = (type: FieldType): type is 'text' | 'long-text' =>
  type === 'text' || type === 'long-text';

/** The part of a draft the API would refuse. */
export type DraftPart = 'key' | 'label' | 'options' | 'maxLength';

export interface DraftProblem {
  readonly index: number;
  readonly part: DraftPart;
}

/** The first draft the API would refuse, or null; an empty list is index -1. */
export function checkDrafts(drafts: readonly FieldDraft[]): DraftProblem | null {
  if (drafts.length === 0 || drafts.length > MAX_FIELDS) return { index: -1, part: 'key' };
  const keys = new Set<string>();
  for (const [index, draft] of drafts.entries()) {
    if (!isKey(draft.key) || keys.has(draft.key)) return { index, part: 'key' };
    keys.add(draft.key);
    if (!isName(draft.label)) return { index, part: 'label' };
    if (draft.type === 'choice') {
      const optionKeys = new Set<string>();
      if (draft.options.length === 0 || draft.options.length > MAX_OPTIONS) {
        return { index, part: 'options' };
      }
      for (const option of draft.options) {
        if (!isKey(option.key) || optionKeys.has(option.key) || !isName(option.label)) {
          return { index, part: 'options' };
        }
        optionKeys.add(option.key);
      }
    }
    if (hasLimit(draft.type) && draft.maxLength.trim() !== '') {
      const limit = Number(latinDigits(draft.maxLength.trim()));
      if (!Number.isInteger(limit) || limit < 1 || limit > TEXT_LIMITS[draft.type]) {
        return { index, part: 'maxLength' };
      }
    }
  }
  return null;
}

/** The body of `POST objects/definitions/:id/revisions` for checked drafts. */
export function revisionBody(drafts: readonly FieldDraft[]) {
  return {
    fields: drafts.map((draft) => ({
      ...(draft.id === undefined ? {} : { id: draft.id }),
      key: draft.key,
      label: draft.label.trim(),
      type: draft.type,
      required: draft.required,
      sensitive: draft.sensitive,
      portal: draft.portal,
      ...(draft.type === 'choice'
        ? { options: draft.options.map((o) => ({ key: o.key, label: o.label.trim() })) }
        : {}),
      ...(hasLimit(draft.type) && draft.maxLength.trim() !== ''
        ? { maxLength: Number(latinDigits(draft.maxLength.trim())) }
        : {}),
    })),
  };
}

/** `drafts` with the one at `index` moved by `by` places (kept inside the list). */
export function moveDraft<T>(drafts: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= drafts.length) return [...drafts];
  const next = [...drafts];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

// Record values (modules/objects/domain/record-values.ts).

/** Persian and Arabic-Indic digits as ASCII (ADR-0008); the API reads them the same way. */
export function latinDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export interface ValueContext {
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
}

/** A record's fields for the record screens: the described fields the member may read. */
export const readableFields = (fields: readonly DescribedField[]) => fields.filter((f) => f.read);

/** The record list's columns: the first readable fields, at most `count`. */
export const listColumns = (fields: readonly DescribedField[], count = 3) =>
  readableFields(fields).slice(0, count);

const pad = (value: number) => String(value).padStart(2, '0');

/** The wall-clock parts of `epochMs` in `timeZone`, as an ISO date and hours and minutes. */
function zonedParts(epochMs: number, timeZone: string) {
  // Parts are read by type, in ASCII digits and the Gregorian calendar, whatever the language.
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(epochMs);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** The instant (epoch ms) at which `timeZone`'s wall clock reads the given date and time. */
export function zonedEpochMs(isoDate: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (epochMs: number) => {
    const p = zonedParts(epochMs, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - epochMs;
  };
  // Twice, so an instant across an offset change (daylight saving) settles on its own offset.
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/** Control characters are refused; a long text may hold line breaks and tabs (as the API). */
function fitsCharacters(text: string, type: 'text' | 'long-text'): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    const allowed = type === 'long-text' && (code === 0x0a || code === 0x09 || code === 0x0d);
    if ((code < 0x20 || code === 0x7f) && !allowed) return false;
  }
  return true;
}

/** The API's one stored form of a decimal: no leading or trailing zeros, no "-0". */
export function canonicalDecimal(text: string): string | undefined {
  const match = /^(-?)(\d{1,20})(?:\.(\d{1,10}))?$/.exec(text);
  if (match === null) return undefined;
  const whole = match[2]!.replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const zero = whole === '0' && fraction === '';
  return `${match[1] === '-' && !zero ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/** The text an input shows for a stored value (ASCII digits; dates in the tenant's calendar). */
export function inputText(
  field: DescribedField,
  value: StoredValue | undefined,
  ctx: ValueContext,
) {
  if (value === undefined) return '';
  switch (field.type) {
    case 'boolean':
      return value === true ? 'true' : 'false';
    case 'date':
      return typeof value === 'string' ? toEditableText(value, ctx.calendar) : '';
    case 'date-time': {
      const epochMs = typeof value === 'string' ? Date.parse(value) : Number.NaN;
      if (Number.isNaN(epochMs)) return '';
      const p = zonedParts(epochMs, ctx.timeZone);
      const iso = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
      return `${toEditableText(iso, ctx.calendar)} ${pad(p.hour)}:${pad(p.minute)}`;
    }
    default:
      return String(value);
  }
}

/** What an input's text sends: `null` clears the field, `undefined` is text that does not fit. */
export function valueOf(
  field: DescribedField,
  text: string,
  ctx: ValueContext,
): StoredValue | null | undefined {
  const isText = field.type === 'text' || field.type === 'long-text';
  // A text is sent as typed (the API keeps spaces); only an empty box clears it.
  const trimmed = isText ? text : text.trim();
  if (trimmed === '') return null;
  switch (field.type) {
    case 'text':
    case 'long-text': {
      const limit = field.maxLength ?? TEXT_LIMITS[field.type];
      return [...text].length <= limit && fitsCharacters(text, field.type) ? text : undefined;
    }
    case 'integer': {
      const digits = latinDigits(trimmed);
      if (!/^-?(0|[1-9]\d{0,15})$/.test(digits)) return undefined;
      const number = Number(digits);
      return Number.isSafeInteger(number) && !Object.is(number, -0) ? number : undefined;
    }
    case 'decimal':
      return canonicalDecimal(latinDigits(trimmed).replace('٫', '.'));
    case 'boolean':
      return trimmed === 'true' ? true : trimmed === 'false' ? false : undefined;
    case 'date':
      return parseEditableText(latinDigits(trimmed), ctx.calendar) ?? undefined;
    case 'date-time': {
      const match = /^(.+?)\s+(\d{1,2}):(\d{2})$/.exec(latinDigits(trimmed));
      if (match === null) return undefined;
      const iso = parseEditableText(match[1]!, ctx.calendar);
      const hour = Number(match[2]);
      const minute = Number(match[3]);
      if (iso === null || hour > 23 || minute > 59) return undefined;
      return new Date(zonedEpochMs(iso, hour, minute, ctx.timeZone)).toISOString();
    }
    case 'choice':
      return field.options?.some((option) => option.key === trimmed) ? trimmed : undefined;
  }
}

/** The changes of an edit: each editable field whose value differs from the record's. */
export function changesOf(
  fields: readonly DescribedField[],
  record: Readonly<Record<string, StoredValue>>,
  sent: Readonly<Record<string, StoredValue | null>>,
): Record<string, StoredValue | null> {
  const changes: Record<string, StoredValue | null> = {};
  for (const field of fields) {
    if (!field.update || !Object.hasOwn(sent, field.key)) continue;
    const before = record[field.key] ?? null;
    const after = sent[field.key] ?? null;
    if (before !== after) changes[field.key] = after;
  }
  return changes;
}

/** A number field: its column and its value align to the end. */
export const isNumeric = (field: Pick<DescribedField, 'type'>) =>
  field.type === 'integer' || field.type === 'decimal';

/**
 * A stored decimal (a canonical string, up to 20 + 10 digits) in the locale's digits, grouping
 * and decimal separator, with no rounding: the string is formatted, never read as a float.
 */
export function formatDecimal(text: string, locale: string): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return toLocaleDigits(text, locale);
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 10 });
  return format.format(text as `${number}`);
}

/** A stored value for reading: the tenant's calendar, time zone and digits. */
export function displayValue(
  field: Pick<DescribedField, 'type' | 'options'>,
  value: StoredValue | undefined,
  ctx: ValueContext,
  words: { readonly yes: string; readonly no: string },
): string {
  if (value === undefined) return '';
  switch (field.type) {
    case 'integer':
      return typeof value === 'number' ? formatNumber(value, ctx.locale) : String(value);
    case 'decimal':
      return formatDecimal(String(value), ctx.locale);
    case 'boolean':
      return value === true ? words.yes : words.no;
    case 'date':
      return typeof value === 'string' ? formatDate(value, ctx) : String(value);
    case 'date-time': {
      const epochMs = typeof value === 'string' ? Date.parse(value) : Number.NaN;
      if (Number.isNaN(epochMs)) return String(value);
      return new Intl.DateTimeFormat(`${ctx.locale}-u-ca-${ctx.calendar}`, {
        timeZone: ctx.timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(epochMs);
    }
    case 'choice':
      return field.options?.find((option) => option.key === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** The tone of a definition's status badge. */
export const STATUS_TONE: Readonly<Record<DefinitionStatus, 'neutral' | 'success' | 'warning'>> = {
  draft: 'neutral',
  published: 'success',
  retired: 'warning',
};

/** The path of the Object's records screen. */
export const recordsPath = (key: string) => `/objects/o/${key}`;

/**
 * The sites of `rootId`'s subtree, from sites in tree order with their depth (the session's
 * site list): a record may live at the definition's site or below it (ADR-0018).
 */
export function subtreeOf<T extends { readonly id: string; readonly depth: number }>(
  sites: readonly T[],
  rootId: string,
): T[] {
  const start = sites.findIndex((site) => site.id === rootId);
  if (start < 0) return [];
  const root = sites[start]!;
  const subtree = [root];
  for (const site of sites.slice(start + 1)) {
    if (site.depth <= root.depth) break;
    subtree.push(site);
  }
  return subtree;
}
