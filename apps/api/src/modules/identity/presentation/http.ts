import { HttpException } from '@nestjs/common';
import { parseId } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { ACCESS_DENIED_STATUS, type AccessDenied } from '../../../platform/authz';

// The HTTP edge of the identity controllers: request parsing and the error body of
// platform-foundations 5.1, `{ statusCode, code }`, plus the field name of an invalid value.

/** The expected failures of the identity use cases and their HTTP status. */
const FAILURE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  'identity.value.invalid': 400,
  'identity.account.not-found': 404,
  'identity.account.username-taken': 409,
  'identity.account.not-local': 409,
  'identity.account.own-account': 422,
  'identity.account.not-linked': 409,
  'identity.account.disabled': 409,
  'identity.role.not-found': 404,
  'identity.role.key-taken': 409,
  'identity.role.not-editable': 409,
  'identity.role-assignment.not-found': 404,
  'identity.role-assignment.exists': 409,
  'identity.site.not-found': 404,
  // GrantPolicy and LastHolderPolicy: the reason of a refused grant is never answered.
  'role.not-grantable': 403,
  'member.self': 422,
  'member.outranks-actor': 403,
  'member.last-holder': 409,
  'sign-in.flow-invalid': 400,
  'sign-in.rejected': 401,
  'sign-in.no-staff-account': 403,
  'sign-in.account-disabled': 403,
  'sign-in.unavailable': 503,
  'portal.method-unavailable': 409,
  'portal.delivery-failed': 503,
  'portal.code-invalid': 400,
  'portal.account-disabled': 403,
  'portal.unavailable': 503,
  'captcha.invalid': 400,
  'rate-limit.exceeded': 429,
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

/** A UUIDv7 in a body, branded as the id of `K`. */
export const idField = <K extends string>() =>
  z
    .string()
    .refine((text) => parseId(text).ok, 'must be a UUIDv7')
    .transform((text) => text as Id<K>);
