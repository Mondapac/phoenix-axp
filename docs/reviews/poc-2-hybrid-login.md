# PoC 2 (slice 0.7): hybrid login, revoke and disable on the next request

Status: Phase 0 spike, report only (D5). Branch `spike/poc-1-2-tenancy-identity` at `73ecee4`
(spike code in `8aafd6b`); the code is not for merge, Phase 1 copies from it. Rules under test: ADR-0004 as amended by ADR-0019, ADR-0018
(site-scoped grants), ADR-0009 (licences).

## خلاصه برای صاحب پروژه

- ورود ترکیبی کار می‌کند: کاربر سازمانی (از LDAP، از طریق Keycloak) و کاربر محلی (کارمند تعریف‌شده
  در Keycloak) هر دو با OIDC Authorization Code + PKCE وارد می‌شوند و به **همان** use case با
  **همان** قاعده‌ی دسترسی می‌رسند؛ ماتریس نتیجه برای هر دو دقیقاً یکی است.
- نشست مات است و در پایگاه داده فقط هش SHA-256 توکن (۳۲ بایت) ذخیره می‌شود؛ هیچ کشی وجود ندارد و
  هر درخواست دوباره بررسی می‌شود.
- **لغو نقش** و **غیرفعال‌کردن حساب محلی** دقیقاً از درخواست بعدی اثر می‌کنند (پذیرفته).
- **غیرفعال‌کردن کاربر در LDAP/AD** خودبه‌خود به هسته نمی‌رسد: Keycloak برای آن هیچ پیام
  back-channel نمی‌فرستد. فقط ورود جدید رد می‌شود و نشست موجود تا اجرای کار همگام‌سازی (sync)
  زنده می‌ماند. با sync اثر در درخواست بعدی دیده شد. پس تأخیر برابر فاصله‌ی اجرای sync است؛ این
  یک **تغییر طراحی** است: sync دوره‌ای کوتاه (یا رویداد از AD) لازم است.
- خروج از Keycloak (back-channel logout) نشست هسته را در درخواست بعدی می‌بندد (پذیرفته، فقط برای
  logout).
- هزینه‌ی هر درخواست احراز‌شده با ۵ unit حدود ۲۳ میلی‌ثانیه (p50) است؛ پیشنهاد: یک unit برای
  «تصویر کاربر» در هر درخواست، و تنظیم tenant در لایه‌ی adapter (تغییر طراحی).

## Setup

| Part | What ran |
| --- | --- |
| Node | 24.22.1, pnpm 10.28.0 |
| PostgreSQL | 16.15, own cluster on port 5433, database `phoenix_poc2` (ADR says 17: deviation, see "Not tested") |
| Keycloak | 26.8.1 distribution archive from Maven Central, `kc.sh start-dev` on 127.0.0.1:8181, dev-file store. Docker: `dockerd` started, but the image pull from quay.io was refused by the egress proxy (403), so the archive was used |
| Directory | UnboundID LDAP SDK 7.0.3 in-memory server (`spike/poc-2/ldap/InMemoryLdap.java`) on 127.0.0.1:10389, base `dc=phoenix,dc=test`. **Test-only**; licence choice LGPL-2.1 (the SDK is offered under GPLv2, LGPLv2.1 or the UnboundID Free Use licence). Not shipped, not a production dependency |
| Core | the API with `IDENTITY_SPIKE=on`, on 127.0.0.1:3190 (3100 was taken by another workload) |
| Realms | `phoenix-demo-fa`: LDAP federation (vendor other, `entryUUID`, READ_ONLY, no cache, user filter `(!(employeeType=disabled))`) plus local users `bahar`, `sara`, `lena`; `phoenix-demo-en`: local user `emma`. Created by `spike/poc-2/keycloak/setup-realms.mjs` |
| Client | `phoenix-studio`: confidential, standard flow only, PKCE S256 required, back-channel logout URL `/spike/backchannel/<tenant>/logout` with session required. Service account `phoenix-core-admin` (view-users, manage-users) for the core's admin calls |
| Data | `spike/poc-2/seed.sql`: demo-fa tree root -> province-1 -> county-1 and root -> province-2; demo-en root -> branch; 5 items per site; roles `editor` (content.item.read) and `staff-admin` (identity.*) |

Licences of what ran: Keycloak Apache-2.0, PgBouncer ISC (PoC 1), UnboundID LDAP SDK LGPL-2.1
test-only. Nothing new enters the production dependency set (`pnpm licences`: holds).

Reproduce: `START_SERVICES=1 spike/poc-2/setup.sh`, then in `apps/api`
`node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.spike.config.cjs poc2`
(and again with `UNIT_TENANT_SESSION=adapter`). Results: `spike/poc-2/results/hybrid-login*.json`.

## What was built (in the spike)

- **Sign-in** (`modules/identity`): `BeginStaffSignIn` issues a flow secret (cookie
  `__Host-phoenix-flow`, SameSite=Lax because the IdP redirect is a cross-site navigation) from
  which state, nonce and the PKCE verifier are derived by HMAC; `CompleteStaffSignIn` exchanges
  the code, verifies the ID token (RS256, JWKS, issuer, audience, nonce), then:
  - a directory user (LDAP-federated in Keycloak) without a core account gets one just in time,
    **with no roles**;
  - a local user must already have a core account (created through studio, ADR-0019 decision 3);
    an unknown local user is refused `sign-in.no-staff-account`.
- **Session**: 32 random bytes, base64url in cookie `__Host-phoenix-studio` (HttpOnly, Secure,
  SameSite=Strict); the row stores only `sha256(token)` (CHECK length 32) and Keycloak's `sid`.
  No cache: the `ActorGuard` authenticates the cookie on every request through the
  `Authenticator` port (one read-only unit).
- **Authorisation**: Mondapac's `UseCase` / `UseCaseGate` / `AccessRule` ported. The use case
  `ListSiteContent` declares `access = permissions(content.item.read)`; the gate asks the
  `AuthorisationCheck` (identity) whether the actor holds the permission anywhere, then the use
  case asks `permittedAtSite` for the target site, which uses PoC 1's closure-table rule (grant at
  the site, or at an ancestor with `includeDescendants`). Not permitted at the site answers 404
  `site.not-found` (no existence leak).
- **Revoke / disable**: `RevokeRoleGrant` deletes the grant; `DisableLocalStaffAccount` disables the
  core account and deletes its sessions in one unit, then disables the user in Keycloak and logs
  out its IdP sessions. A directory account cannot be disabled from studio (409
  `account.not-local`): its source of truth is AD.
- **Back-channel logout**: `POST /spike/backchannel/:tenant/logout` verifies the logout token
  (signature, iss, aud, iat, events claim, `sid`, no nonce) and deletes the sessions with that
  `sid`.
- **Sync path** (ADR-0004 decision 3): `SyncStaffAccountsWithIdp`, a `system` use case, asks
  Keycloak's admin API for each active account; a missing or disabled user is disabled in the
  core and its sessions end.

## Method

`test/spike/poc2-hybrid-login.spike-spec.ts` drives a scripted browser (`poc2-browser.ts`, a
cookie jar and real HTTP to Keycloak's login form and the core). The `x-tenant-id` header that the
BFF would set is set by the test browser. The ten tests:

1. Sign-in of every user; session row shape.
2. PKCE is enforced by Keycloak (authorization request without `code_challenge`).
3. Same rules: alice (LDAP) and bahar (local) both hold `editor` at province-1 with
   `includeDescendants`; each is sent to county-1, province-1, province-2, root and an unknown site.
   emma (demo-en), anonymous, and alice's cookie with demo-en's header too.
4. Revoke: a loop of requests runs while the grant is revoked; count what is allowed after the
   revoke call answered; then one more request.
5. LDAP disable: set `employeeType: disabled` on dariush in LDAP; request; try a new Keycloak
   login; run the sync; request.
6. Local disable through studio (sara with `staff-admin` disables bahar); also a directory
   account (409) and a caller without the permission (403).
7. Back-channel: logout of the user's session from the Keycloak admin API; separately, disable in
   the Keycloak console (admin API) then the sync; a forged logout token.
8. Provisioning: nima (LDAP, no grants) and lena (local, no core account).
9. Per-request cost: 400 sequential authenticated `ListSiteContent` requests, 400 anonymous
   refusals.

## Raw numbers

Default mode (`hybrid-login.json`):

| Check | Result |
| --- | --- |
| Sign-in alice, dariush (LDAP); bahar, sara (local fa); emma (local en) | 200 each |
| Session row | 1 row; hash 32 bytes; hash = sha256(cookie); raw token in row: no; IdP `sid` stored |
| Request without PKCE | Keycloak 302 `error=invalid_request` (refused) |
| alice: county-1 / province-1 / province-2 / root / unknown | 200 / 200 / 404 / 404 / 404 |
| bahar: same five | 200 / 200 / 404 / 404 / 404 (identical) |
| emma (demo-en, branch below grant) | 200 |
| anonymous | 401 |
| alice's cookie with demo-en tenant | 401 |
| Revoke: requests started after revoke answered | 29, allowed 0; next request 403 (adapter mode: 36, allowed 0) |
| LDAP disable: request before sync | 200 (session still live) |
| LDAP disable: new Keycloak login | refused |
| LDAP disable: sync | 4 accounts checked, 1 disabled, 104 ms |
| LDAP disable: next request after sync | 401; account `disabled`; 1298 ms from the LDAP change in this test (sync run by hand after 1 s) |
| Local disable (studio) | 200, sessionsEnded 1, idpDisabled true; next request 401; Keycloak enabled=false; new login refused |
| Disable a directory account from studio | 409 `account.not-local` |
| Disable without the permission | 403 `access.denied` |
| Keycloak admin logout (back-channel) | Keycloak 204; next core request 401 |
| Disable in Keycloak console | next core request 200 (no back-channel sent); after sync 401 |
| Forged logout token | 400 |
| nima (LDAP, first sign-in) | 200, account created `directory`, studio 403 (no roles) |
| lena (local, no core account) | 403 `sign-in.no-staff-account` |

Per-request cost (loopback, 4 vCPU shared with other workloads, ms):

| Request | n | mean | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- |
| Authenticated `ListSiteContent`, 5 units | 400 | 24.3 | 22.9 | 39.7 | 57.4 |
| Same, tenant set in adapter (`UNIT_TENANT_SESSION=adapter`) | 400 | 18.5 | 17.0 | 29.0 | 42.9 |
| Anonymous, refused at the gate | 400 | 1.9 | 1.7 | 3.0 | 5.2 |

The 5 units of one authenticated request: session lookup, grants (gate), grants again
(`permittedAtSite`), site ancestors, content page. All functional results are identical in the
adapter mode (`hybrid-login-adapter-session.json`).

## What was not tested

- A real Active Directory (only an LDAP server with `entryUUID`); Kerberos/SPNEGO; AD group to role
  mapping; nested groups.
- MFA, password policy, brute-force protection, Keycloak in production mode (TLS, clustered cache,
  PostgreSQL store); Keycloak ran `start-dev` on a file store.
- The BFF: the test browser sets `x-tenant-id` itself. CSRF protection for studio's POSTs.
  `Secure` cookies over plain http only worked because the test jar does not enforce `Secure`.
- Logout-token `jti` replay protection (verified signature and claims only).
- The `GrantPolicy` of ADR-0018 (who may grant what where), audit of revoke/disable, the event
  that should tell other modules.
- How often the sync runs, its cost with thousands of accounts per tenant, and Keycloak's own
  LDAP periodic sync (not used: NO_CACHE and on-login lookup).
- The back-channel endpoint breaks two platform rules on purpose (see "Design changes").
- PostgreSQL 17 (ran on 16.15); Docker images (pull refused by the proxy).

## Verdicts

| # | Risk | Verdict | Detail |
| --- | --- | --- | --- |
| 1 | LDAP users and local users cannot share one sign-in and one rule set | **accepted** | One Keycloak realm per tenant with LDAP federation plus local users, one OIDC client, one code path; identical decision matrix for alice and bahar. |
| 2 | Code flow + PKCE with an opaque core session | **accepted** | PKCE S256 enforced by Keycloak; only sha256 of the token stored; forged hash 401; cross-tenant cookie 401. |
| 3 | Role revoke on the next request | **accepted** | 0 of 29 requests after the revoke answered were allowed; no cache to invalidate. |
| 4 | Local account disable on the next request | **accepted** | Core first (account + sessions in one unit), then Keycloak disable + logout; next request 401, re-login refused. |
| 5 | LDAP/AD disable on the next request | **design change** | Keycloak sends nothing when a federated user is disabled in the directory (nor when an admin disables a user in the console). The core learns it only through the sync path, so the latency equals the sync interval (1.3 s here only because the test ran the sync by hand). Change: ADR-0004's sync must be a scheduled `system` job with an owner-set short interval (proposal: 1 to 5 min per tenant), plus a manual "sync now" in studio; where the customer can, an AD change event (or Keycloak admin event listener) triggers the sync. The ADR wording "next request" must be qualified as "next request after the sync" for directory disables. |
| 6 | Back-channel logout | **accepted for logout only** | Keycloak's back-channel logout ends the core session on the next request; it is not a disable signal (see 5). Phase 1 also needs `jti` replay protection and a platform entry adapter for IdP-to-core calls: the spike controller mints its own context and uses the tenant exemption, which the lint/boundary rules forbid (4 lint + 4 depcruise errors, left visible on purpose). |
| 7 | JIT provisioning | **accepted** | Directory users get an account with no roles; unknown local users are refused (ADR-0019 decision 3 holds). |
| 8 | Per-request cost of an uncached session + grants | **design change** | 5 units per request: p50 22.9 ms / p95 39.7 ms; with the tenant set in the adapter 17.0 / 29.0 ms. Change: one read-only "actor snapshot" unit per request (session + account status + grants in one transaction), reused by the gate and `permittedAtSite`, plus PoC 1's adapter-level tenant session. Still no cache across requests. |
