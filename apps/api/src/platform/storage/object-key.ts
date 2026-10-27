import { parseId } from '@phoenix/shared-kernel';
import type { Id, TenantContext } from '@phoenix/shared-kernel';

/**
 * The key of one stored object (ADR-0012 decision 2): `<tenant>/<module>/<id>`. The tenant
 * comes from a minted TenantContext, so a key can never name another tenant's object, and the
 * id is a parsed Id, so a key holds no file name, path segment or personal data.
 */
export type ObjectKey = string & { readonly __brand: 'ObjectKey' };

// The owning module's folder name under src/modules/ (lower-case, like a tenant id).
const MODULE_NAME = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * Builds the key of the object `id` owned by `module` for the tenant of `tenant`. A malformed
 * module name or id is a programmer error and throws: both come from code, never from input.
 */
export function objectKey<K extends string>(
  tenant: TenantContext,
  module: string,
  id: Id<K>,
): ObjectKey {
  if (!MODULE_NAME.test(module)) {
    throw new TypeError('objectKey: the module must be a module folder name');
  }
  if (!parseId(id).ok) throw new TypeError('objectKey: the id must be a parsed value');
  return `${tenant.tenantId}/${module}/${id}` as ObjectKey;
}
