// The worker thread of the form schema engine (security review of slice 2.4, H1 follow-up):
// Ajv compiles staff-written schemas and validates citizen answers here, under the worker's
// resource limits, so a schema or an answer that exhausts memory or runs too long ends this
// thread, not the API process. The host (worker-schema-engine.ts) starts it with
// `resourceLimits`, times every request out and replaces a thread that failed.
//
// Self-contained on purpose: it imports node modules only and uses only erasable TypeScript,
// so Node runs this file as it is in tests (type stripping) and as compiled JavaScript (.mjs)
// in the build. The message types are repeated in the host; schema-worker.spec.ts runs both.
import { parentPort } from 'node:worker_threads';
import { Ajv, type ValidateFunction } from 'ajv';
// ajv-formats is CommonJS: imported from ES module code, its plugin is the `default` member.
import ajvFormats from 'ajv-formats';
import { RE2JS } from 're2js';

/** A request from the host. */
type Request =
  | { readonly id: number; readonly op: 'check'; readonly schema: object }
  | {
      readonly id: number;
      readonly op: 'validate';
      readonly key: string;
      readonly schema: object;
      readonly data: unknown;
    };

/** One refusal of an answer: where and which keyword, never the value or Ajv's message. */
interface AnswerProblem {
  readonly pointer: string;
  readonly keyword: string;
}

type Reply =
  | { readonly id: number; readonly ok: true }
  | {
      readonly id: number;
      readonly ok: false;
      readonly problem: 'meta-schema' | 'not-compilable';
      readonly pointer?: string;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly problem: 'answers';
      readonly errors: AnswerProblem[];
    };

/**
 * `pattern` and `patternProperties` run on re2js: linear-time matching, no backreferences or
 * lookaround, so a staff-written pattern cannot backtrack catastrophically on citizen input
 * (the regex engine choice of the 2.4 handoff). A pattern RE2 cannot parse does not compile.
 */
function regExp(
  pattern: string,
  flags: string,
): { test(text: string): boolean; toString(): string } {
  const compiled = RE2JS.compile(pattern);
  return {
    test: (text: string) => compiled.test(text),
    // Ajv keys its cache of compiled patterns on this string.
    toString: () => `/${pattern}/${flags}`,
  };
}
regExp.code = 're2js';

/** The Ajv options of every compile; `inlineRefs: false` is the 2.4 security review's H1. */
const OPTIONS = {
  strictSchema: true,
  strictNumbers: true,
  strictTypes: false,
  strictTuples: false,
  strictRequired: false,
  allowUnionTypes: true,
  addUsedSchema: false,
  inlineRefs: false,
  allErrors: false,
  logger: false,
  code: { regExp },
} as const;

/** The most compiled validators kept; the oldest is dropped first. */
const MAX_VALIDATORS = 64;
/** The most problems one answer reports. */
const MAX_PROBLEMS = 20;
const validators = new Map<string, ValidateFunction>();

function check(id: number, schema: object): Reply {
  // A fresh Ajv instance per check, so a check that failed half-way leaves nothing behind.
  try {
    const ajv = ajvFormats.default(new Ajv(OPTIONS));
    if (ajv.validateSchema(schema) !== true) {
      const [first] = ajv.errors ?? [];
      const pointer = first?.instancePath;
      return pointer
        ? { id, ok: false, problem: 'meta-schema', pointer }
        : { id, ok: false, problem: 'meta-schema' };
    }
    ajv.compile(schema);
    return { id, ok: true };
  } catch {
    return { id, ok: false, problem: 'not-compilable' };
  }
}

function validatorOf(key: string, schema: object): ValidateFunction {
  const known = validators.get(key);
  if (known !== undefined) {
    validators.delete(key);
    validators.set(key, known);
    return known;
  }
  const validate = ajvFormats.default(new Ajv({ ...OPTIONS, allErrors: true })).compile(schema);
  validators.set(key, validate);
  if (validators.size > MAX_VALIDATORS) {
    const oldest = validators.keys().next().value;
    if (oldest !== undefined) validators.delete(oldest);
  }
  return validate;
}

function validate(id: number, key: string, schema: object, data: unknown): Reply {
  let run: ValidateFunction;
  try {
    run = validatorOf(key, schema);
  } catch {
    return { id, ok: false, problem: 'not-compilable' };
  }
  if (run(data) === true) return { id, ok: true };
  const errors = (run.errors ?? []).slice(0, MAX_PROBLEMS).map((error) => {
    // `required` and `additionalProperties` name the member in their params, not the path.
    const params = error.params as Record<string, unknown>;
    const member = params.missingProperty ?? params.additionalProperty;
    return {
      pointer:
        typeof member === 'string'
          ? `${error.instancePath}/${member.replace(/~/g, '~0').replace(/\//g, '~1')}`
          : error.instancePath,
      keyword: error.keyword,
    };
  });
  return { id, ok: false, problem: 'answers', errors };
}

parentPort?.on('message', (request: Request) => {
  const reply =
    request.op === 'check'
      ? check(request.id, request.schema)
      : validate(request.id, request.key, request.schema, request.data);
  parentPort?.postMessage(reply);
});
