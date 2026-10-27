import { HttpException } from '@nestjs/common';
import { parseId } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { ACCESS_DENIED_STATUS, type AccessDenied } from '../../../platform/authz';

// The HTTP edge of the tenancy controllers: request parsing and the error body of
// platform-foundations 5.1, `{ statusCode, code }`, plus the field name of an invalid value.

/** The expected failures of the tenancy use cases and their HTTP status. */
const FAILURE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  'tenancy.value.invalid': 400,
  'tenancy.site.not-found': 404,
  'tenancy.organization.not-found': 404,
  'tenancy.site-domain.not-found': 404,
  'tenancy.site.slug-taken': 409,
  'tenancy.site-domain.taken': 409,
  'tenancy.tree.depth-exceeded': 422,
  'tenancy.tree.move-into-own-subtree': 422,
  'tenancy.tenant-settings.depth-below-tree': 422,
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

/** A path parameter that must be a UUIDv7: anything else is a 404 of `notFound`. */
export function idParam<K extends string>(text: string, notFound: string): Id<K> {
  const id = parseId<K>(text);
  return id.ok ? id.value : fail(404, notFound);
}

/** A UUIDv7 in a body or query, branded as the id of `K`; null stays null. */
export const idField = <K extends string>() =>
  z
    .string()
    .refine((text) => parseId(text).ok, 'must be a UUIDv7')
    .transform((text) => text as Id<K>);
