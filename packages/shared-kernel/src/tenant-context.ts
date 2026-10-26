import { mint } from './minted';
import type { Minted } from './minted';
import { err, ok } from './result';
import type { Result } from './result';

/**
 * The id of a tenant: the mandatory isolation dimension of every request, job, event and
 * tenant-scoped row (ADR-02). It fits `tenant_id varchar(32)`.
 */
export type TenantId = string & { readonly __brand: 'TenantId' };

/**
 * The tenant a piece of work belongs to (ADR-01, ADR-02): present, well formed, immutable and
 * minted. There is no default tenant and no fallback.
 *
 * It holds nothing else: locale, calendar and time zone are tenant configuration, read by
 * `tenantId`. The kernel guarantees the shape only; "hosted by this deployment" is the
 * guarantee of the single production constructor in the platform.
 */
export interface TenantContext extends Minted<'TenantContext'> {
  readonly tenantId: TenantId;
}

// The single definition of the rule. The database repeats it as a CHECK constraint.
const TENANT_ID = /^[a-z][a-z0-9-]{1,31}$/;

export function parseTenantId(
  text: string,
): Result<TenantId, { readonly code: 'tenant-id.invalid' }> {
  // The run-time type check matters: RegExp.test() would turn an array into a string.
  if (typeof text !== 'string' || !TENANT_ID.test(text)) {
    return err({ code: 'tenant-id.invalid' });
  }
  return ok(text as TenantId);
}

/**
 * Mints the context of one tenant. Called by the platform's tenant-context factory only;
 * tests use the builder on the `/testing` entry.
 *
 * It takes a parsed value and cannot fail for it. The brand is compile-time only, so the
 * pattern is checked again here: a value forced through a type assertion is a programmer
 * error and throws, which keeps "minted" meaning "well formed".
 */
export function mintTenantContext(tenantId: TenantId): TenantContext {
  if (!parseTenantId(tenantId).ok) {
    throw new TypeError('mintTenantContext: the tenant id must be a parsed value');
  }
  return mint<TenantContext>({ tenantId });
}
