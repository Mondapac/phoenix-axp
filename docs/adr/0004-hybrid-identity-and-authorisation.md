# ADR-0004: Hybrid Identity — Keycloak Authentication, Core Sessions and Authorisation

**Status:** Accepted — 2026-10-26 (owner decision: hybrid identity, Phase 0 inputs item 11)
**Relates to:** MondaPac ADR-0018 (sessions and authorisation model; its decision 10 names
Keycloak as the path for enterprise SSO), ADR-0002, ADR-0015

## Context
Government and enterprise customers need SSO, LDAP/Active Directory, SAML, OIDC, MFA, and the
platform as an identity provider for other systems from day one. MondaPac builds identity
in-house with server-side sessions and an application-layer authorisation model that is tested
and transferable.

## Decision
1. **Authentication by Keycloak** (Apache-2.0): SSO, LDAP/AD, SAML, OIDC, MFA, IdP role. The
   core connects with OIDC Authorization Code + PKCE, starting from MondaPac's
   `oidc-sign-in-providers` adapter. Keycloak answers "who are you" only and holds no roles or
   permissions. MFA is mandatory for administrators (in Keycloak, or the organisation's IdP).
2. **Sessions in the core** (MondaPac): opaque server-side session in PostgreSQL storing only the
   SHA-256 of the token; no JWT in the browser; no session or permission cache — suspension,
   role removal and disabling apply on the next request; `__Host-` cookies, `SameSite=Strict`
   for admin; CSRF = HMAC of the session token + Origin check; one host per panel. Separate
   sessions per population (platform-operator, tenant-staff, portal-user).
3. **Upstream disable.** Disabling a user in LDAP or Keycloak ends core sessions through
   back-channel logout or synchronisation; proven in PoC 2.
4. **Authorisation in the application layer:** every use case extends `UseCase` with a static
   `access` rule — `permissions`, `anonymous`, `own-resources` or `system`. Silence is never a
   default; a use case without a rule fails CI. `UseCaseGate` runs before `handle`; controller
   guards only authenticate; jobs and AI tools pass the same gate.
5. **A permission never grants a resource:** tenant, site and organisation ownership come from
   the `ActorContext`, never from input; another owner's resource answers "not found".
6. **Catalogue as code:** keys `<module>.<resource>.<action>` in `contracts/permissions.ts`,
   registered in `platform/authz`; unknown keys grant nothing.
7. **Roles:** system, default (versioned seed) and custom; `GrantPolicy` (no granting beyond your
   own keys), `LastHolderPolicy`, protected keys granted only by system roles. Scopes: platform,
   tenant, site/organisation. Optional LDAP group → role mapping only through an audited use
   case. Record-level permissions for Objects and forms.
8. **Audit:** every permission and role change is audited (ADR-0015).
9. **Transferred from MondaPac:** `platform/authz`, `platform/call-context`, the role model with
   its policies, `test/authz` and the contract snapshots. **Not transferred:** registration,
   passwords (argon2), password reset and in-house MFA (about half of MondaPac's identity code).

## Consequences
- Two systems to operate (Keycloak + core); revocation consistency is a tested risk (PoC 2).
- security-tester review is mandatory on every identity, session and authorisation change.

## Alternatives considered
- Fully in-house identity (MondaPac): lacks SAML/LDAP/IdP for government.
- Keycloak for authorisation too: couples domain permissions to the IdP; loses the declared
  `access` rule and CI enforcement.
