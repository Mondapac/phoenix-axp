// SPIKE: the identity module's public API (contracts and the Nest module only).
export {
  IDENTITY_ROLE_GRANT_REVOKE,
  IDENTITY_STAFF_ACCOUNT_DISABLE,
} from './contracts/permissions';
export { STAFF_ACCESS_FACADE, type StaffAccessFacade } from './contracts/staff-access.facade';
export { IdentityModule } from './identity.module';
