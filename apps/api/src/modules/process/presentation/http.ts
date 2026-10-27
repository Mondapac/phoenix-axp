import { HttpException } from '@nestjs/common';
import type { Result } from '@phoenix/shared-kernel';
import type { z } from 'zod';
import { ACCESS_DENIED_STATUS, type AccessDenied } from '../../../platform/authz';

// The HTTP edge of the process controllers: request parsing and the error body of
// platform-foundations 5.1, `{ statusCode, code }`, plus the field name of an invalid value.

/** The expected failures of the process use cases and their HTTP status. */
const FAILURE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  'process.bpmn.malformed': 400,
  'process.bpmn.too-large': 413,
  'process.bpmn.process-key-mismatch': 422,
  'process.bpmn.forbidden-construct': 422,
  ...ACCESS_DENIED_STATUS,
});

type Failure = AccessDenied | { readonly code: string; readonly field?: string };

const fail = (statusCode: number, code: string, field?: string): never => {
  throw new HttpException(
    field === undefined ? { statusCode, code } : { statusCode, code, field },
    statusCode,
  );
};

/** The value of an `ok`, or the HTTP answer of the failure. */
export function answer<T>(result: Result<T, Failure>): T {
  if (result.ok) return result.value;
  const failure: Failure = result.error;
  const status = FAILURE_STATUS[failure.code];
  // A code without a status is a programmer error: a 500, as any other exception.
  if (status === undefined) throw new Error(`No HTTP status for "${failure.code}"`);
  return fail(status, failure.code, 'field' in failure ? failure.field : undefined);
}

/** A body or query parsed by `schema`; 400 `request.invalid` naming the first bad field. */
export function parseRequest<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  return fail(400, 'request.invalid', issue?.path.join('.') || undefined);
}
