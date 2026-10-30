// The texts a form shows, read from its documents (ADR-0007): a label or description per
// locale lives in the UI Schema element's `options.labels` / `options.descriptions`, keyed by
// locale tag; the element's `label` and the schema's `title` are the fallbacks. The JSON
// Schema stays plain draft-07 (the API's Ajv is strict and refuses unknown keywords), so
// translations never go into it. Error messages come from the panel's own texts by Ajv keyword.

type Json = { readonly [key: string]: unknown };

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The text for `locale` from a per-locale map: the exact tag, then its language, then none. */
export function textFor(map: unknown, locale: string): string | undefined {
  if (!isRecord(map)) return undefined;
  const exact = map[locale];
  if (typeof exact === 'string' && exact.trim() !== '') return exact;
  const language = locale.split('-')[0] ?? locale;
  for (const [tag, text] of Object.entries(map)) {
    if ((tag === language || tag.split('-')[0] === language) && typeof text === 'string') {
      if (text.trim() !== '') return text;
    }
  }
  return undefined;
}

/** The last segment of a scope (`#/properties/a/properties/b` gives `b`). */
export function nameOfScope(scope: unknown): string {
  if (typeof scope !== 'string') return '';
  const parts = scope.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * The label of a UI Schema element in `locale`: `options.labels`, then a string `label`, then
 * the schema's `title`, then the property name.
 */
export function labelOf(element: unknown, schema: unknown, locale: string): string {
  const el = isRecord(element) ? element : {};
  const options = isRecord(el.options) ? el.options : {};
  const translated = textFor(options.labels, locale);
  if (translated !== undefined) return translated;
  if (typeof el.label === 'string' && el.label.trim() !== '') return el.label;
  if (isRecord(schema) && typeof schema.title === 'string' && schema.title.trim() !== '') {
    return schema.title;
  }
  return nameOfScope(el.scope);
}

/** The description of an element in `locale`, or undefined. */
export function descriptionOf(
  element: unknown,
  schema: unknown,
  locale: string,
): string | undefined {
  const el = isRecord(element) ? element : {};
  const options = isRecord(el.options) ? el.options : {};
  const translated = textFor(options.descriptions, locale);
  if (translated !== undefined) return translated;
  if (isRecord(schema) && typeof schema.description === 'string' && schema.description !== '') {
    return schema.description;
  }
  return undefined;
}

/** The label of an enum value: `options.choices[].labels` in `locale`, else the value. */
export function choiceLabel(element: unknown, value: string, locale: string): string {
  const el = isRecord(element) ? element : {};
  const options = isRecord(el.options) ? el.options : {};
  const choices: readonly unknown[] = Array.isArray(options.choices) ? options.choices : [];
  const choice = choices.find((item) => isRecord(item) && item.value === value);
  return (isRecord(choice) ? textFor(choice.labels, locale) : undefined) ?? value;
}

/** The texts of the validation errors, by Ajv keyword; `{limit}` is replaced. */
export interface FormErrorTexts {
  readonly required: string;
  readonly minLength: string;
  readonly maxLength: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly pattern: string;
  readonly email: string;
  readonly date: string;
  readonly number: string;
  readonly choice: string;
  readonly invalid: string;
}

/** The fewest facts of an Ajv error the message needs (Ajv's `ErrorObject`). */
export interface FormError {
  readonly keyword: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The message of one validation error, in the panel's language and digits. */
export function errorText(
  error: FormError,
  texts: FormErrorTexts,
  formatLimit: (limit: number) => string,
): string {
  const limit = (name: string) => {
    const value = error.params[name];
    return typeof value === 'number' ? formatLimit(value) : '';
  };
  switch (error.keyword) {
    case 'required':
      return texts.required;
    case 'minLength':
      return texts.minLength.replace('{limit}', limit('limit'));
    case 'maxLength':
      return texts.maxLength.replace('{limit}', limit('limit'));
    case 'minimum':
    case 'exclusiveMinimum':
      return texts.minimum.replace('{limit}', limit('limit'));
    case 'maximum':
    case 'exclusiveMaximum':
      return texts.maximum.replace('{limit}', limit('limit'));
    case 'pattern':
      return texts.pattern;
    case 'format':
      return error.params.format === 'email'
        ? texts.email
        : error.params.format === 'date'
          ? texts.date
          : texts.invalid;
    case 'type':
      return error.params.type === 'number' || error.params.type === 'integer'
        ? texts.number
        : texts.invalid;
    case 'enum':
      return texts.choice;
    default:
      return texts.invalid;
  }
}
