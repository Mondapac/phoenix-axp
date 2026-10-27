import { Injectable } from '@nestjs/common';
import { ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormSchemaChecker } from '../application/ports/form-schema-checker';
import { invalidSchema, type InvalidSchema, type JsonObject } from '../domain/form-schema';

/**
 * The schema checker on Ajv (MIT), JSON Schema draft-07, the draft JSON Forms targets. Strict
 * about the schema itself (unknown keywords and formats are refused, so a typo never silently
 * validates nothing) and lenient about style (types, tuples and `required` need not be
 * spelled out). Nothing is loaded from the network: a `$ref` that leaves the document is
 * refused by the shape rules before this runs, and Ajv has no `loadSchema`.
 *
 * One Ajv instance; each compiled schema is removed again, so the instance holds only the
 * meta-schemas and the checks share no state.
 */
@Injectable()
export class AjvFormSchemaChecker implements FormSchemaChecker {
  private readonly ajv = addFormats(
    new Ajv({
      strictSchema: true,
      strictNumbers: true,
      strictTypes: false,
      strictTuples: false,
      strictRequired: false,
      allowUnionTypes: true,
      addUsedSchema: false,
      logger: false,
    }),
  );

  check(dataSchema: JsonObject): Result<void, InvalidSchema> {
    if (this.ajv.validateSchema(dataSchema) !== true) {
      const [first] = this.ajv.errors ?? [];
      return invalidSchema('jsonSchema', 'meta-schema', first?.instancePath || undefined);
    }
    try {
      this.ajv.compile(dataSchema);
      return ok(undefined);
    } catch {
      // Ajv's message may quote the schema; the answer carries the code only.
      return invalidSchema('jsonSchema', 'not-compilable');
    } finally {
      this.ajv.removeSchema(dataSchema);
    }
  }
}
