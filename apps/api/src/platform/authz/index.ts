// SPIKE (PoC 2): the barrel modules import platform/authz from.
export { ACCESS_DENIED_STATUS, DENIED, type AccessDenied } from './access-denied';
export { definePermission, type AccessDeclaration, type PermissionKey } from './access-rule';
export {
  AUTHORISATION_CHECK,
  type AccessDecision,
  type AuthorisationCheck,
} from './authorisation-check';
export {
  AUTHENTICATOR,
  STUDIO_SESSION_COOKIE,
  type Authenticator,
  type CredentialRejected,
} from './authenticator';
export { UseCase } from './use-case';
export { USE_CASE_GATE, type UseCaseGate } from './use-case-gate';
export { httpFailure } from './http-failure';
