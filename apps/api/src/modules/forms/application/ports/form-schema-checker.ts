import type { ContentHash, Result } from '@phoenix/shared-kernel';
import type { InvalidSchema, JsonObject } from '../../domain/form-schema';

/**
 * Checks a data schema against the JSON Schema meta-schema and compiles it the way the
 * submission validator will (strict mode, the standard formats, `pattern` on RE2). Implemented
 * with Ajv (MIT) in a worker thread under resource limits (infrastructure layer). Called
 * before the unit of work, never inside it.
 */
export interface FormSchemaChecker {
  check(dataSchema: JsonObject): Promise<Result<void, InvalidSchema>>;
}

export const FORM_SCHEMA_CHECKER = Symbol('FORM_SCHEMA_CHECKER');

/** One refusal of the answers: where (a JSON pointer into them) and which keyword. */
export interface AnswerProblem {
  readonly pointer: string;
  readonly keyword: string;
}

/**
 * The answers do not satisfy the revision's schema. Names places and keywords only, never a
 * value: answers are personal data.
 */
export type InvalidAnswers = {
  readonly code: 'forms.submission.invalid';
  readonly problems: readonly AnswerProblem[];
};

/**
 * Validates answers against a published revision's JSON Schema, with the same engine as the
 * checker; compiled validators are kept per content hash. Called before the unit of work.
 */
export interface AnswerValidator {
  validate(
    revision: { readonly contentHash: ContentHash; readonly jsonSchema: JsonObject },
    answers: JsonObject,
  ): Promise<Result<void, InvalidAnswers>>;
}

export const ANSWER_VALIDATOR = Symbol('ANSWER_VALIDATOR');
