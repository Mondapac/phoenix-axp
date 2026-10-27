// Ported from Mondapac apps/api/src/platform/authz/index.ts. What a module may use from
// `platform/authz`: a module imports from this file only (dependency-cruiser
// `modules-reach-authz-through-its-barrel`): the base class, the declaration types, the
// permission helpers and registry, the answers, the gate's token and type, the authorisation
// check's port and token (identity implements it), the site-ancestry port and token (tenancy
// implements it) with the subtree helpers, and the role model with its policies. The gate's
// factory, the declaration checks and the placeholders stay inside `platform/`.
export { ACCESS_DENIED_STATUS, type AccessDenied } from './access-denied';
export type { AccessDeclaration, AccessRule, PermissionKey } from './access-rule';
export {
  AUTHORISATION_CHECK,
  type AccessDecision,
  type AuthorisationCheck,
} from './authorisation-check';
export {
  declarePermissions,
  definePermission,
  MAX_PERMISSION_KEY_LENGTH,
  populationOfScope,
  type PermissionCatalogue,
  type PermissionDeclaration,
  type PermissionScope,
} from './permission';
export { PERMISSION_KEY_LOOKUP, type PermissionKeyLookup } from './permission-key-lookup';
export { frozenKeySet } from './frozen-key-set';
export {
  PermissionRegistry,
  registerPermissions,
  type SealedPermissionCatalogue,
} from './permission-registry';
export {
  grantCoversSite,
  SITE_ANCESTRY_READER,
  siteRelation,
  type SiteAncestryReader,
  type SiteRelation,
} from './site-scope';
export {
  GrantPolicy,
  type ActedOnAccount,
  type CannotActOn,
  type GrantedRole,
  type Grantee,
  type GrantingActor,
  type GrantPlacement,
  type NotGrantable,
  type NotGrantableReason,
  type ProtectedKeyCatalogue,
} from './roles/grant-policy';
export { LastHolderPolicy, type LastHolder } from './roles/last-holder-policy';
export {
  permissionScopesOfRole,
  populationOfRoleScope,
  ROLE_KINDS,
  ROLE_SCOPES,
  roleScopesOf,
  type GrantScope,
  type RoleKind,
  type RoleScope,
} from './roles/role-model';
export { UseCase, UseCaseDefinitionError } from './use-case';
export type { UseCaseGate } from './use-case-gate';
export { USE_CASE_GATE } from './use-case-gate.token';
