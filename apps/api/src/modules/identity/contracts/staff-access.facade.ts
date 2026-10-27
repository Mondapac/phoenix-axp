// SPIKE (PoC 2): identity's public read for other modules: does the actor hold these keys at
// this site (ADR-0018 decision 6: a site grant covers the site, and its subtree when it
// includes descendants)? Read from PostgreSQL on every call.
import type { CallContext } from '@phoenix/shared-kernel';
import type { PermissionKey } from '../../../platform/authz';

export interface StaffAccessFacade {
  permittedAtSite(
    context: CallContext,
    keys: readonly PermissionKey[],
    siteId: string,
  ): Promise<boolean>;
}

export const STAFF_ACCESS_FACADE = Symbol('STAFF_ACCESS_FACADE');
