import type { Result, TenantContext } from '@phoenix/shared-kernel';
import type { DirectoryStatus } from '../domain/directory-sync';

/**
 * What the tenant's identity provider says about its directory users (Keycloak's admin API on
 * the tenant's realm, which looks each federated user up in AD/LDAP). Calls go over HTTP, so
 * never inside a unit. `unavailable` when the provider cannot answer for every subject: the
 * sync then changes nothing.
 */
export interface StaffDirectory {
  statusOf(
    tenant: TenantContext,
    subjects: readonly string[],
  ): Promise<Result<ReadonlyMap<string, DirectoryStatus>, 'directory.unavailable'>>;
}

export const STAFF_DIRECTORY = Symbol('STAFF_DIRECTORY');
