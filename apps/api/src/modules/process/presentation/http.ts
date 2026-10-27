import { HttpException } from '@nestjs/common';
import { parseId } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { ACCESS_DENIED_STATUS, type AccessDenied } from '../../../platform/authz';

// The HTTP edge of the process controllers: request parsing and the error body of
// platform-foundations 5.1, `{ statusCode, code }`, plus the field name of an invalid value.

/** The expected failures of the process use cases and their HTTP status. */
const FAILURE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  'process.bpmn.malformed': 400,
  'process.bpmn.too-large': 413,
  'process.bpmn.process-key-mismatch': 422,
  'process.bpmn.forbidden-construct': 422,
  'process.bpmn.unbounded-flow': 422,
  'process.bpmn.task-setting-invalid': 422,
  'process.form.not-found': 422,
  'process.form.starts-another-process': 409,
  'process.task.not-found': 404,
  'process.task.unavailable': 409,
  'process.task.outcome-invalid': 422,
  'process.task.assignee-ineligible': 422,
  'process.calendar.invalid': 422,
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

/** A path id, branded; anything but a UUIDv7 is the resource's 404. */
export function idParam<K extends string>(text: string, notFound: string): Id<K> {
  const id = parseId<K>(text);
  return id.ok ? id.value : fail(404, notFound);
}

/** A UUIDv7 in a body, branded as the id of `K`. */
export const idField = <K extends string>() =>
  z
    .string()
    .refine((text) => parseId(text).ok, 'must be a UUIDv7')
    .transform((text) => text as Id<K>);
