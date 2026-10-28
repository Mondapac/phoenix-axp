import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// The value rules of the objects module (ADR-0017). The migration repeats the key and name
// rules as CHECKs, so a row that skipped this code is still refused by the database.

/** A definition's or a field's key: lower-case ASCII letters and digits joined by hyphens. */
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_KEY_LENGTH = 64;

/** A display name or label, trimmed: 1 to 200 characters. */
export const MAX_NAME_LENGTH = 200;

/** An invalid input value: its field name, never the value itself. */
export type InvalidValue = { readonly code: 'objects.value.invalid'; readonly field: string };

export const invalid = (field: string): Result<never, InvalidValue> =>
  err({ code: 'objects.value.invalid', field });

export function parseKey(value: string, field = 'key'): Result<string, InvalidValue> {
  return value.length <= MAX_KEY_LENGTH && KEY.test(value) ? ok(value) : invalid(field);
}

/** Trims; refuses an empty or overlong name and one with control characters. */
export function parseName(value: string, field = 'name'): Result<string, InvalidValue> {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || [...name].some(isControl)) {
    return invalid(field);
  }
  return ok(name);
}

const isControl = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};
