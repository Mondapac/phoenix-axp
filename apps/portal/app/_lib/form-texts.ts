import type { SchemaFormTexts } from '@phoenix/ui';
import type { Messages } from '../_i18n/messages';

/** The SchemaForm texts from the portal's messages. */
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
    required: t['form.required'],
    choose: t['formText.choose'],
    next: t['formText.next'],
    back: t['formText.back'],
    stepOf: t['formText.stepOf'],
  };
}

/** A form key as the API accepts it (modules/forms/domain/values.ts); anything else is 404. */
export const isFormKey = (value: string) =>
  value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
