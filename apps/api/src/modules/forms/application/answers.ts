import { canonicalJson, err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import type { FormField } from '../domain/form-fields';
import { isJsonObject, type JsonObject } from '../domain/form-schema';
import { MAX_ANSWERS_BYTES } from '../domain/submission';
import type { InvalidAnswers } from './ports/form-schema-checker';

const refused = (keyword: string, pointer = ''): Result<never, InvalidAnswers> =>
  err({ code: 'forms.submission.invalid', problems: [{ pointer, keyword }] });

/**
 * The answers as sent, by property name: a JSON object of at most {@link MAX_ANSWERS_BYTES} of
 * canonical JSON whose members are all properties of the revision (an unknown member is
 * refused, not dropped). The schema's own rules are checked by the validator afterwards.
 */
export function readAnswers(
  value: unknown,
  fields: readonly FormField[],
): Result<JsonObject, InvalidAnswers> {
  if (!isJsonObject(value)) return refused('type');
  const text = canonicalJson(value);
  if (!text.ok) return refused('type');
  if (Buffer.byteLength(text.value, 'utf8') > MAX_ANSWERS_BYTES) return refused('maxLength');
  const names = new Set(fields.map((field) => field.name));
  const unknown = Object.keys(value).find((name) => !names.has(name));
  if (unknown !== undefined) return refused('additionalProperties', `/${escape(unknown)}`);
  return ok(value);
}

/** JSON pointer escaping (RFC 6901). */
const escape = (name: string): string => name.replace(/~/g, '~0').replace(/\//g, '~1');

/** The answers keyed by field id, the form they are stored and projected in. */
export function answersById(
  answers: JsonObject,
  fields: readonly FormField[],
): Record<string, unknown> {
  const byId: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(answers, field.name)) byId[field.id] = answers[field.name];
  }
  return byId;
}

/** The canonical UTF-8 bytes that are sealed under the submission's subject key. */
export function answersBytes(byId: Record<string, unknown>): Buffer {
  const text = canonicalJson(byId);
  // The answers were canonical JSON already (readAnswers); re-keying keeps them so.
  if (!text.ok) throw new Error('answersBytes: the answers are not canonical JSON');
  return Buffer.from(text.value, 'utf8');
}

/** Stored answers read back; anything but a JSON object is treated as no answers. */
export function answersFromBytes(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  return isJsonObject(value) ? { ...value } : {};
}
