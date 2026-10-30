import type { SchemaFormTexts } from '@phoenix/ui';
import type { Messages } from '../_i18n/messages';
import type { SavedField } from './form-design';

// The forms API as the studio reads it (modules/forms, slices 2.4 and 2.5), and the value
// rules the screens check before sending; the API checks everything again.

export const FORM_STATUSES = ['draft', 'published', 'retired'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];
export const AUDIENCES = ['anyone', 'portal-user', 'staff', 'staff-roles'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CHANNELS = ['anonymous', 'portal-user', 'staff', 'on-behalf'] as const;

export interface FormPolicy {
  readonly audience: Audience;
  readonly roleIds: readonly string[];
  readonly allowOnBehalf: boolean;
}

export type Retention =
  { readonly kind: 'forever' } | { readonly kind: 'fixed'; readonly days: number };

export interface FormRecord {
  readonly id: string;
  readonly siteId: string;
  readonly key: string;
  readonly name: string;
  readonly status: FormStatus;
  readonly publishedRevisionId: string | null;
  readonly policy: FormPolicy;
  readonly retention: Retention;
  readonly latestRevisionNumber: number;
  readonly version: number;
}

export interface RevisionSummary {
  readonly id: string;
  readonly number: number;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface FormView extends FormRecord {
  readonly revisions: readonly RevisionSummary[];
}

export interface RevisionView extends RevisionSummary {
  readonly jsonSchema: Record<string, unknown>;
  readonly uiSchema: Record<string, unknown>;
  readonly fields: readonly SavedField[] | null;
}

export interface SubmissionView {
  readonly id: string;
  readonly formId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly channel: (typeof CHANNELS)[number];
  readonly status: string;
  readonly submittedAt: string;
  readonly erased: boolean;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export interface VisibleField {
  readonly id: string;
  readonly name: string;
}

export interface InboxPage {
  readonly items: readonly SubmissionView[];
  readonly fields: readonly VisibleField[];
  readonly next: string | null;
}

/** The API's form key rule (modules/forms/domain/values.ts). */
export const MAX_KEY_LENGTH = 64;
export const MAX_FORM_NAME_LENGTH = 200;
export const MAX_RETENTION_DAYS = 36_500;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isFormKey = (value: string) => value.length <= MAX_KEY_LENGTH && KEY.test(value);
export const isFormName = (value: string) => {
  const name = value.trim();
  return (
    name.length > 0 &&
    name.length <= MAX_FORM_NAME_LENGTH &&
    ![...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
  );
};
export const isRetentionDays = (days: number) =>
  Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS;

/** The status badge's tone. */
export const STATUS_TONE: Readonly<Record<FormStatus, 'neutral' | 'success' | 'warning'>> = {
  draft: 'neutral',
  published: 'success',
  retired: 'warning',
};

/** The inbox cursor shape the API hands out (`<epoch ms>.<uuid>`); anything else starts over. */
export const isInboxCursor = (value: string | undefined): value is string =>
  value !== undefined && /^\d{1,15}\.[0-9a-f-]{36}$/.test(value);

/** An answer as text for the inbox; structured answers are shown as compact JSON. */
export function answerText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** The SchemaForm texts from the studio's messages. */
export function schemaFormTexts(t: Messages): SchemaFormTexts {
  return {
    errors: {
      required: t['formError.required'],
      minLength: t['formError.minLength'],
      maxLength: t['formError.maxLength'],
      minimum: t['formError.minimum'],
      maximum: t['formError.maximum'],
      pattern: t['formError.pattern'],
      email: t['formError.email'],
      date: t['formError.date'],
      number: t['formError.number'],
      choice: t['formError.choice'],
      invalid: t['formError.invalid'],
    },
    date: {
      open: t['formText.openCalendar'],
      previousMonth: t['formText.previousMonth'],
      nextMonth: t['formText.nextMonth'],
    },
    required: t['common.required'],
    choose: t['formText.choose'],
    next: t['formText.next'],
    back: t['formText.back'],
    stepOf: t['formText.stepOf'],
  };
}

/** A language's name in the viewer's language (`fa-IR` in English is "Persian"). */
export function languageName(locale: string, viewer: string): string {
  try {
    const language = new Intl.Locale(locale).language;
    return new Intl.DisplayNames([viewer], { type: 'language' }).of(language) ?? locale;
  } catch {
    return locale;
  }
}
