import type { Result } from '@phoenix/shared-kernel';
import type { InvalidSchema, JsonObject } from '../../domain/form-schema';

/**
 * Checks a data schema against the JSON Schema meta-schema and compiles it the way the
 * submission validator will (strict mode, the standard formats), so a revision that is saved
 * can always validate a submission. Implemented with Ajv (MIT) in the infrastructure layer.
 * Pure CPU work: called before the unit of work, never inside it.
 */
export interface FormSchemaChecker {
  check(dataSchema: JsonObject): Result<void, InvalidSchema>;
}

export const FORM_SCHEMA_CHECKER = Symbol('FORM_SCHEMA_CHECKER');
