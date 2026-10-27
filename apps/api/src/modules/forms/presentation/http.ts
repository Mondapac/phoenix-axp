import { HttpException } from '@nestjs/common';
import { parseId } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { ACCESS_DENIED_STATUS, type AccessDenied } from '../../../platform/authz';

// The HTTP edge of the forms controllers: request parsing and the error body of
// platform-foundations 5.1, `{ statusCode, code }`, plus the field of an invalid value and, for
// an invalid schema, the problem and where it is.

/** The expected failures of the forms use cases and their HTTP status. */
const FAILURE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  'forms.value.invalid': 400,
  'forms.schema.invalid': 422,
  'forms.form.not-found': 404,
  'forms.form-revision.not-found': 404,
  'forms.site.not-found': 404,
  'forms.form.key-taken': 409,
  'forms.form.already-published': 409,
  'forms.form.not-published': 409,
  ...ACCESS_DENIED_STATUS,
});

type Failure =
  | AccessDenied
  | {
      readonly code: string;
      readonly field?: string;
      readonly problem?: string;
      readonly pointer?: string;
    };

/** The value of an `ok`, or the HTTP answer of the failure. */
export function answer<T>(result: Result<T, Failure>): T {
  if (result.ok) return result.value;
  const failure: Failure = result.error;
  const statusCode = FAILURE_STATUS[failure.code];
  // A code without a status is a programmer error: a 500, as any other exception.
  if (statusCode === undefined) throw new Error(`No HTTP status for "${failure.code}"`);
  const { field, problem, pointer } = failure as Exclude<Failure, AccessDenied>;
  throw new HttpException(
    {
      statusCode,
      code: failure.code,
      ...(field === undefined ? {} : { field }),
      ...(problem === undefined ? {} : { problem }),
      ...(pointer === undefined ? {} : { pointer }),
    },
    statusCode,
  );
}

const fail = (statusCode: number, code: string, field?: string): never => {
  throw new HttpException(
    field === undefined ? { statusCode, code } : { statusCode, code, field },
    statusCode,
  );
};

/** A body or query parsed by `schema`; 400 `request.invalid` naming the first bad field. */
export function parseRequest<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  return fail(400, 'request.invalid', issue?.path.join('.') || undefined);
}

/** A path parameter that must be a UUIDv7: anything else is a 404 of `notFound`. */
export function idParam<K extends string>(text: string, notFound: string): Id<K> {
  const id = parseId<K>(text);
  return id.ok ? id.value : fail(404, notFound);
}

/** A UUIDv7 in a body or query, branded as the id of `K`. */
export const idField = <K extends string>() =>
  z
    .string()
    .refine((text) => parseId(text).ok, 'must be a UUIDv7')
    .transform((text) => text as Id<K>);
