// Message lookup for schema forms. Two sources, most specific first: the form revision's own
// messages for the viewer's locale (labels, enum labels, a field's own error text) and the app
// catalogue's generic error per JSON Schema keyword. Numbers in messages use the locale digits.
import type { ErrorObject } from 'ajv';
import { toLocaleDigits } from '../text/persian.ts';

export interface FormLabels {
  submit: string;
  submitting: string;
  errorSummaryTitle: string;
  success: string;
  serverError: string;
  requiredMark: string;
  dateFormatHint: string;
  calendar: {
    open: string;
    prevMonth: string;
    nextMonth: string;
    hint: string;
  };
  /** Generic error text per JSON Schema keyword; `{limit}`, `{label}` are filled in. */
  errors: Record<string, string>;
}

export interface FormMessages {
  locale: string;
  form: Record<string, string>;
  labels: FormLabels;
}

/** The property key of an error: `fullName` for /fullName or a missing required fullName. */
export function errorField(error: ErrorObject): string {
  if (error.keyword === 'required') return String(error.params.missingProperty);
  return error.instancePath.replace(/^\//, '').replace(/\//g, '.');
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');

export function createFormTranslator({ locale, form, labels }: FormMessages) {
  const translate = (id: string, defaultMessage?: string): string | undefined =>
    form[id] ?? defaultMessage;

  const errorText = (error: ErrorObject): string => {
    const field = errorField(error);
    const specific = form[`${field}.error.${error.keyword}`];
    const generic = labels.errors[error.keyword] ?? labels.errors.default ?? error.message ?? '';
    const limit = 'limit' in error.params ? String(error.params.limit) : '';
    return fill(specific ?? generic, {
      limit: toLocaleDigits(limit, locale),
      label: form[`${field}.label`] ?? field,
    });
  };

  return { translate, errorText };
}
