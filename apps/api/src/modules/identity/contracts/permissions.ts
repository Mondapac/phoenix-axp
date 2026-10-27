// SPIKE (PoC 2): identity's permission keys (catalogue as code, ADR-0004 decision 6).
import { definePermission } from '../../../platform/authz';

export const IDENTITY_ROLE_GRANT_REVOKE = definePermission('identity.role-grant.revoke');
export const IDENTITY_STAFF_ACCOUNT_DISABLE = definePermission('identity.staff-account.disable');
