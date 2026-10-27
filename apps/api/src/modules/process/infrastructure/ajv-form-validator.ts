import { Ajv } from 'ajv';
import type { FormValidator } from '../application/ports/collaborators';

/**
 * JSON Schema (draft-07, Ajv, MIT) validation of a submission. Schemas are compiled once per
 * form revision content: a published revision never changes (V1), so the cache never goes stale.
 */
export class AjvFormValidator implements FormValidator {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });
  private readonly compiled = new WeakMap<object, ReturnType<Ajv['compile']>>();

  invalidFields(jsonSchema: object, answers: unknown): readonly string[] {
    let validate = this.compiled.get(jsonSchema);
    if (validate === undefined) {
      validate = this.ajv.compile(jsonSchema);
      this.compiled.set(jsonSchema, validate);
    }
    if (validate(answers)) return [];
    return [...new Set((validate.errors ?? []).map((error) => error.instancePath || '/'))];
  }
}
