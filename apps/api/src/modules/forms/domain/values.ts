import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// The value rules of the forms module. The migration repeats each one as a CHECK, so a row that
// skipped this code is still refused by the database.

/** A form's key: lower-case ASCII letters and digits joined by single hyphens, 1 to 64. */
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_KEY_LENGTH = 64;

/** A form's display name, trimmed: 1 to 200 characters. */
export const MAX_NAME_LENGTH = 200;

export type InvalidValue = { readonly code: 'forms.value.invalid'; readonly field: string };

export const invalid = (field: string): Result<never, InvalidValue> =>
  err({ code: 'forms.value.invalid', field });

export function parseFormKey(value: string): Result<string, InvalidValue> {
  return value.length <= MAX_KEY_LENGTH && KEY.test(value) ? ok(value) : invalid('key');
}

/** Trims; refuses an empty or overlong name and one with control characters. */
export function parseName(value: string): Result<string, InvalidValue> {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || [...name].some(isControl)) {
    return invalid('name');
  }
  return ok(name);
}

const isControl = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};
