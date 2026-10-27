import { createHash } from 'node:crypto';
import { canonicalJson, ok } from '@phoenix/shared-kernel';
import type { ContentHash, Result } from '@phoenix/shared-kernel';
import {
  checkDataSchemaShape,
  checkUiSchema,
  invalidSchema,
  MAX_DOCUMENT_LENGTH,
  type InvalidSchema,
  type JsonObject,
} from '../domain/form-schema';
import type { FormSchemaChecker } from './ports/form-schema-checker';

/** A revision's two documents, checked, with the hash that identifies them (ADR-0007 V3). */
export interface CheckedDocuments {
  readonly jsonSchema: JsonObject;
  readonly uiSchema: JsonObject;
  readonly contentHash: ContentHash;
}

function canonical(field: InvalidSchema['field'], value: unknown): Result<string, InvalidSchema> {
  const text = canonicalJson(value);
  if (!text.ok) return invalidSchema(field, 'not-an-object');
  if (text.value.length > MAX_DOCUMENT_LENGTH) return invalidSchema(field, 'too-large');
  return ok(text.value);
}

/**
 * Checks both documents, data schema first: canonical JSON and size, the module's shape rules,
 * then the meta-schema and compilation through the checker; the UI Schema's scopes are
 * resolved against the checked data schema. The content hash is `sha256:` over the canonical
 * JSON of `{ jsonSchema, uiSchema }`, so equal documents hash equal whatever their key order.
 * CPU only: the caller runs it before its unit of work.
 */
export function checkRevisionDocuments(
  checker: FormSchemaChecker,
  jsonSchema: unknown,
  uiSchema: unknown,
): Result<CheckedDocuments, InvalidSchema> {
  const dataText = canonical('jsonSchema', jsonSchema);
  if (!dataText.ok) return dataText;
  const data = checkDataSchemaShape(jsonSchema);
  if (!data.ok) return data;
  const compiled = checker.check(data.value);
  if (!compiled.ok) return compiled;
  const uiText = canonical('uiSchema', uiSchema);
  if (!uiText.ok) return uiText;
  const ui = checkUiSchema(uiSchema, data.value);
  if (!ui.ok) return ui;
  // Canonical JSON of the pair, written from the two canonical texts.
  const pair = `{"jsonSchema":${dataText.value},"uiSchema":${uiText.value}}`;
  const digest = createHash('sha256').update(pair, 'utf8').digest('hex');
  return ok({
    jsonSchema: data.value,
    uiSchema: ui.value,
    contentHash: `sha256:${digest}` as ContentHash,
  });
}
