# ADR-0026: Portal Users Sign In With One-Time Codes Verified by the Core

**Status:** Accepted — 2026-10-28 (team decision for slice 1.8, `cto` and `software-architect`
roles; the owner card "how a public user signs in again" is open, and this ADR follows the
recommended option until it is answered)
**Amends:** ADR-0019 decision 2 ("in Keycloak"), ADR-0004 decision 1 for the `portal-user`
population only
**Relates to:** ADR-0022 decision 1 (P1), ADR-0003 (per-subject keys), ADR-0010, ADR-0002

## Context
Owner decision P1 (ADR-0022): a public user signs up with a mobile number (one-time SMS code) or
an email address, and each tenant chooses which. ADR-0019 put the public user "in Keycloak".
Keycloak 26 can register by email but has no SMS step: a mobile path in Keycloak needs a Java
authenticator extension, a second language and build in the repository, and a call from that
extension back to each tenant's SMS provider. Each tenant's SMS provider is configured in the
core (P1 implementation note), and the core already has the pieces a code needs: the
proof-of-work CAPTCHA, rate limits and per-subject keys (slice 2.5).

## Decision
1. **The core verifies portal users.** A `portal-user` signs in, and signs up on the first
   sign-in, with a one-time code sent to an email address or a mobile number; there is no
   password. Keycloak keeps staff (ADR-0019 decision 3) and holds no portal user. "Sign in"
   and "sign up" are one flow, so the answer to "send me a code" never says whether an account
   exists.
2. **Per tenant.** Each tenant enables `email`, `mobile`, both or neither (default: neither, so
   a new tenant's portal sign-in is closed until a staff member with
   `identity.portal-sign-in.manage` opens it). The tenant also sets its country calling code,
   which turns a national mobile number (leading 0) into E.164.
3. **The code.** Six digits, valid 5 minutes, at most 5 wrong answers, then a new code is
   needed. Only an HMAC of the code (keyed from `SESSION_SECRET`, bound to the challenge id)
   and an HMAC of the address are stored; the address itself is never stored with the code.
   A code request needs a solved proof-of-work challenge and passes three rate limits: per
   address, per client network and per tenant (the last caps a tenant's SMS spend).
4. **Personal data.** The address is sealed under the account's subject key (ADR-0003); its
   lookup is a keyed hash (blind index) derived from the subject-key KEK, unique per tenant and
   kind. Addresses never reach logs, audit values or events.
5. **Sessions.** A portal session is an opaque core session of its own population, in the
   portal's own `__Host-phoenix-portal` cookie (`SameSite=Lax`, so a link into the portal from
   another site arrives signed in; writes still need the CSRF token and Origin). The
   authenticator binds the cookie to its population: a staff session in the portal cookie, or a
   portal session in the studio cookie, is rejected. A portal user can never hold a role
   (ADR-0019 decision 2): staff account reads exclude portal accounts.
6. **Delivery behind ports** (no hard dependency): `platform/mail` (SMTP, written on
   `node:net`/`node:tls`, no library) and `platform/sms` (no provider built in; a development
   adapter relays each SMS to the mail catcher and is refused in production). A tenant's SMS
   provider adapter lands with the first tenant that names one (ADR-0010).

## Consequences
- Slice 1.8 builds the portal sign-in on these rules; the owner card can still switch to
  passwords in Keycloak, which would add a Keycloak user per portal account and keep the code
  for sign-up and recovery.
- Every portal sign-in by mobile costs the tenant one SMS; the per-tenant ceiling bounds abuse.
- Staff who use the portal keep their Keycloak sign-in; a "staff in the portal" door is a later
  story.
- A lost mailbox or number means a lost account until an account-recovery story exists.

## Alternatives considered
- Keycloak registration plus an SMS authenticator extension: a Java build in the repository
  and a callback from Keycloak to the core for each tenant's provider; rejected for phase 1.
- Core-verified sign-up that then creates a Keycloak user with a password: needs the
  `manage-users` admin role on every realm and a core-built password reset for mobile-only
  users; it is the owner card's second option.
