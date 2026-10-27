import { Injectable } from '@nestjs/common';
import { ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormSchemaChecker } from '../application/ports/form-schema-checker';
import { invalidSchema, type InvalidSchema, type JsonObject } from '../domain/form-schema';

/** The Ajv options of every check; `inlineRefs: false` is the security review's H1. */
const OPTIONS = {
  strictSchema: true,
  strictNumbers: true,
  strictTypes: false,
  strictTuples: false,
  strictRequired: false,
  allowUnionTypes: true,
  addUsedSchema: false,
  // Inlining copies a definition's code into every `$ref` to it, so the compile grows with
  // (definition size x references): a 59 KB schema exhausted the heap. Without it each
  // definition is compiled once.
  inlineRefs: false,
  logger: false,
} as const;

/**
 * The schema checker on Ajv (MIT), JSON Schema draft-07, the draft JSON Forms targets. Strict
 * about the schema itself (unknown keywords and formats are refused, so a typo never silently
 * validates nothing) and lenient about style (types, tuples and `required` need not be
 * spelled out). Nothing is loaded from the network: a `$ref` that leaves the document and a
 * `$schema` other than draft-07 are refused by the shape rules before this runs, which also
 * bound the number of members and references; Ajv has no `loadSchema`.
 *
 * A fresh Ajv instance per check, so a check that failed half-way (a stack overflow in the
 * compiler) leaves nothing behind for the next one.
 */
@Injectable()
export class AjvFormSchemaChecker implements FormSchemaChecker {
  check(dataSchema: JsonObject): Result<void, InvalidSchema> {
    // Ajv's messages may quote the schema; the answers carry codes only.
    try {
      const ajv = addFormats(new Ajv(OPTIONS));
      if (ajv.validateSchema(dataSchema) !== true) {
        const [first] = ajv.errors ?? [];
        return invalidSchema('jsonSchema', 'meta-schema', first?.instancePath || undefined);
      }
      ajv.compile(dataSchema);
      return ok(undefined);
    } catch {
      return invalidSchema('jsonSchema', 'not-compilable');
    }
  }
}
