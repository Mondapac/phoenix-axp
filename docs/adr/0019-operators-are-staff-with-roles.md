# ADR-0019: Operators Are Staff With Roles, One Account per Employee

**Status:** Accepted — 2026-10-27 (owner decision)
**Amends:** ADR-0004 (populations)
**Relates to:** ADR-0002, ADR-0018

## Context
The owner lists four kinds of user: guests, registered public users, organisation employees, and
employees acting as operators (publishing news, managing sites and panels). ADR-0004 names three
populations — platform-operator, tenant-staff, portal-user — but did not say whether an operator
is a separate identity from the same person's employee account.

## Decision
1. **Guest** is the anonymous actor; only use cases with `access: anonymous` serve it.
2. **Public user** is the `portal-user` population: open self-registration (email or mobile,
   in Keycloak). A public user can never hold a staff or operator role.
3. **Employee** is the `tenant-staff` population, signing in through the organisation's
   directory (AD/LDAP via Keycloak). An employee without management roles uses the portal,
   the staff portal and their own inbox.
4. **Operator is not a population.** An operator is an employee holding at least one
   management role. Each employee has exactly one account. The studio panel admits only staff
   with at least one studio permission, and its menu shows only what those permissions allow.
5. One session per panel host still holds (ADR-0004); SSO means an employee moving from the
   portal to studio does not enter a password again. MFA stays mandatory for administrators.
6. `platform-operator` remains a separate population used only by the platform team.

## Consequences
- Role assignment, not account type, decides who manages content; removing the last management
  role closes studio on the next request.
- Leaving the organisation (disabled in AD) ends both portal and studio access together.

## Alternatives considered
- Separate operator accounts: rejected by the owner; two identities per person, double sign-in
  and drift between the accounts.
