import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// The shape rules of a form revision's two documents (ADR-0007 decision 2): a JSON Schema for
// the data and a JSON Forms UI Schema for the layout. These are the rules the meta-schema
// cannot state; the meta-schema itself and the compilation are checked by the schema checker
// port (Ajv) in the application layer.

/** The largest canonical JSON text of each document, in UTF-16 code units (256 KiB). */
export const MAX_DOCUMENT_LENGTH = 256 * 1024;

/**
 * The most object members (at any depth) and the most `$ref`s a
 * data schema may hold: they bound the compiler's work (security review H1). A large form has
 * a few hundred fields of a handful of keywords each.
 */
export const MAX_SCHEMA_MEMBERS = 20_000;
export const MAX_SCHEMA_REFS = 500;

/** The only meta-schema a data schema may name: JSON Schema draft-07, the one Ajv checks. */
export const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

export type SchemaProblem =
  /** Not a plain JSON object, or not representable as canonical JSON. */
  | 'not-an-object'
  | 'too-large'
  /** The root of the data schema must be `"type": "object"` with `properties`. */
  | 'root-not-object'
  /** A `$ref` that leaves the document: no remote schema is ever loaded (offline installs). */
  | 'external-ref'
  /** `$async` schemas are refused: validation is synchronous. */
  | 'async-schema'
  /** A `$schema` other than draft-07. */
  | 'unsupported-draft'
  /** More members or `$ref`s than the compiler is allowed to work through. */
  | 'too-complex'
  /** Refused by the JSON Schema meta-schema. */
  | 'meta-schema'
  /** Valid by the meta-schema, but refused by the validator (strict mode, unknown format). */
  | 'not-compilable'
  /** A UI Schema element without a string `type`. */
  | 'element-malformed'
  /** A `scope` that is not `#/properties/...`, or that names nothing in the data schema. */
  | 'scope-unresolved';

export type InvalidSchema = {
  readonly code: 'forms.schema.invalid';
  readonly field: 'jsonSchema' | 'uiSchema';
  readonly problem: SchemaProblem;
  /** Where in the submitted document, as a JSON Pointer; never a value. */
  readonly pointer?: string;
};

export const invalidSchema = (
  field: InvalidSchema['field'],
  problem: SchemaProblem,
  pointer?: string,
): Result<never, InvalidSchema> =>
  err(
    pointer === undefined
      ? { code: 'forms.schema.invalid', field, problem }
      : { code: 'forms.schema.invalid', field, problem, pointer },
  );

export type JsonObject = { readonly [key: string]: unknown };

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const escapePointer = (segment: string): string =>
  segment.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * Every member of `value`, depth first, with its JSON Pointer. The caller has already made
 * canonical JSON of the document, so its nesting is at most MAX_CANONICAL_JSON_DEPTH.
 */
function* walk(value: unknown, pointer: string): Generator<[string, string, unknown]> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* walk(item, `${pointer}/${index}`);
    return;
  }
  if (!isJsonObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const at = `${pointer}/${escapePointer(key)}`;
    yield [key, at, item];
    yield* walk(item, at);
  }
}

/**
 * The data schema's own rules: an object at the root with `properties`, draft-07 only,
 * references only inside the document, no asynchronous keywords, and bounded size.
 */
export function checkDataSchemaShape(schema: unknown): Result<JsonObject, InvalidSchema> {
  if (!isJsonObject(schema)) return invalidSchema('jsonSchema', 'not-an-object');
  if (schema.type !== 'object' || !isJsonObject(schema.properties)) {
    return invalidSchema('jsonSchema', 'root-not-object');
  }
  if (schema.$schema !== undefined && schema.$schema !== DRAFT_07) {
    return invalidSchema('jsonSchema', 'unsupported-draft', '/$schema');
  }
  let members = 0;
  let refs = 0;
  for (const [key, at, value] of walk(schema, '')) {
    members += 1;
    if (members > MAX_SCHEMA_MEMBERS) return invalidSchema('jsonSchema', 'too-complex');
    if (key === '$ref') {
      if (typeof value !== 'string' || !value.startsWith('#')) {
        return invalidSchema('jsonSchema', 'external-ref', at);
      }
      refs += 1;
      if (refs > MAX_SCHEMA_REFS) return invalidSchema('jsonSchema', 'too-complex', at);
    }
    if (key === '$async') return invalidSchema('jsonSchema', 'async-schema', at);
  }
  return ok(schema);
}

/** The value a JSON Pointer fragment (`#/a/b`) names in `document`, or undefined. */
function resolve(document: JsonObject, fragment: string): unknown {
  if (fragment === '#') return document;
  if (!fragment.startsWith('#/')) return undefined;
  let node: unknown = document;
  for (const raw of fragment.slice(2).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isJsonObject(node) || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * The UI Schema's rules: every element of the layout tree (`elements`) is an object with a
 * string `type`, and every element `scope` names a schema under `properties` of the data
 * schema. Nested detail layouts (`options.detail`) are scoped to an array's items and are left
 * to the renderer.
 */
export function checkUiSchema(
  uiSchema: unknown,
  dataSchema: JsonObject,
): Result<JsonObject, InvalidSchema> {
  if (!isJsonObject(uiSchema)) return invalidSchema('uiSchema', 'not-an-object');
  const pending: [unknown, string][] = [[uiSchema, '']];
  while (pending.length > 0) {
    const [element, pointer] = pending.pop()!;
    if (!isJsonObject(element) || typeof element.type !== 'string') {
      return invalidSchema('uiSchema', 'element-malformed', pointer);
    }
    if (element.scope !== undefined) {
      const { scope } = element;
      if (
        typeof scope !== 'string' ||
        !scope.startsWith('#/properties/') ||
        !isJsonObject(resolve(dataSchema, scope))
      ) {
        return invalidSchema('uiSchema', 'scope-unresolved', `${pointer}/scope`);
      }
    }
    if (element.elements !== undefined) {
      if (!Array.isArray(element.elements)) {
        return invalidSchema('uiSchema', 'element-malformed', `${pointer}/elements`);
      }
      for (const [index, child] of element.elements.entries()) {
        pending.push([child, `${pointer}/elements/${index}`]);
      }
    }
  }
  return ok(uiSchema);
}
