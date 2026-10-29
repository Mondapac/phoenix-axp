// Ported from Mondapac apps/api/src/platform/authz/index.ts. What a module may use from
// `platform/authz`: a module imports from this file only (dependency-cruiser
// `modules-reach-authz-through-its-barrel`): the base class, the declaration types, the
// permission helpers and registry, the answers, the gate's token and type, the authorisation
// check's and the authenticator's ports and tokens (identity implements them), the site-ancestry port and token (tenancy
// implements it) with the subtree helpers, the role model with its policies, and the field
// policy with its port (identity implements it) and the definition qualifier (ADR-0024), and the
// role-holding port of the task inbox (ADR-0025; identity implements it). The gate's
// factory, the declaration checks and the placeholders stay inside `platform/`.
export { ACCESS_DENIED_STATUS, type AccessDenied } from './access-denied';
export {
  ACTOR_GRANT_READER,
  grantsCoverSite,
  type ActorGrant,
  type ActorGrantReader,
} from './actor-grants';
export type { AccessDeclaration, AccessRule, PermissionKey } from './access-rule';
export {
  AUTHENTICATOR,
  CSRF_HEADER,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIES,
  STUDIO_SESSION_COOKIE,
  type Authenticator,
  type CredentialRejected,
} from './authenticator';
export {
  AUTHORISATION_CHECK,
  type AccessDecision,
  type AuthorisationCheck,
} from './authorisation-check';
export {
  declarePermissions,
  definePermission,
  MAX_PERMISSION_KEY_LENGTH,
  PERMISSION_QUALIFIERS,
  populationOfScope,
  type PermissionCatalogue,
  type PermissionDeclaration,
  type PermissionQualifier,
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
  ALL_DEFINITIONS,
  grantCoversDefinition,
  MAX_QUALIFIER_DEFINITIONS,
  qualifierWithin,
  type DefinitionQualifier,
  type DefinitionScopedGrant,
} from './definition-scope';
export {
  FIELD_DENIED,
  FIELD_DENIED_STATUS,
  FIELD_MODES,
  FIELD_RULE_READER,
  FieldPolicy,
  isVisible,
  narrowerMode,
  resolveFieldAccess,
  type FieldAccess,
  type FieldDenied,
  type FieldDescriptor,
  type FieldGrant,
  type FieldMode,
  type FieldRequest,
  type FieldRuleReader,
} from './field-policy';
export { ROLE_HOLDING_READER, type RoleHolding, type RoleHoldingReader } from './role-holdings';
export {
  grantCoversSite,
  sitesCoveredBy,
  SITE_ANCESTRY_READER,
  siteRelation,
  type SiteAncestryReader,
  type SiteRelation,
} from './site-scope';
export {
  GrantPolicy,
  NO_DEFINITION_ACCESS,
  type ActedOnAccount,
  type CannotActOn,
  type DefinitionAccess,
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
