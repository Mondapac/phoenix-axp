# Deferred platform components

ADR-12 ("defer with a trigger"): no platform component is built before its first consumer, and
each one arrives at the latest in the same change as that consumer. Phase 0 ported from the
Mondapac template only what the skeleton itself uses. This table lists the rest and the
trigger that brings each one in. When a trigger fires, port the component from the template
(adapting Market to Tenant), add its boundary rules with a fixture each, and remove its row.

| Component | What it is | Trigger |
| --- | --- | --- |
| `events` and outbox (ADR-05) | Event envelope, `defineEvent`, a `<module>.outbox` table per module, the relay in the worker (`FOR UPDATE SKIP LOCKED`), the in-process `EventBus`, `inbox` idempotency | The first module that publishes or consumes a domain event |
| `audit` (ADR-09) | `platform.audit_log` (append-only by trigger), `AuditWriter` in the use-case transaction with a closed action catalogue, the hash-chain sealer in the worker, `audit-verify` | The first state-changing use case of a business module (and before any customer pilot) |
| identity integration (ADR-03) | The `Authenticator` building `AuthenticatedActor` from a Keycloak session; `ActorGuard` accepts no session until then and answers 401 `session.invalid` to any `Authorization` header | The identity module, Phase 1 |
| `scheduler` (ADR-05) | Fixed-interval jobs under `pg_try_advisory_xact_lock` in the worker | The first periodic job (the outbox relay or the audit sealer) |
| worker jobs | The worker today starts, logs a heartbeat and stops cleanly on SIGTERM | The first job or consumer (outbox relay, scheduler) |
| `storage` (ADR-11) | The `ObjectStore` port and its SeaweedFS S3 adapter (SeaweedFS is already in `docker-compose.yml`) | The first feature that stores a file |
| `subject-keys` | Per-subject encryption keys for personal data fields, the key wrapper and its port | The first personal data field that must be erasable (identity or forms) |
| `ai` (ADR-10) | `platform/ai/model-gateway`, the only caller of a model, with the provider SDK confined to that folder | Phase 5, the first AI feature |
| `mail` | The mail port and its SMTP adapter (Mailpit locally) | The first message sent to a person (identity verification) |
| `rate-limit` (ADR-11) | Rate limits with `rate-limiter-flexible` on Valkey | The first public unauthenticated write (sign-in, sign-up) or before the first public deployment, whichever comes first |
| `i18n` | Message catalogues and locale negotiation against the tenant's `supportedLocales` | The first user-facing text produced by the API |
| reviewed raw reads (Mondapac ADR-0030) | `RawReadPort` and a closed, reviewed list of read-only statements for modules; today raw SQL is allowed only in the platform files of `RAW_SQL_FILES` in `scripts/check-prisma-boundaries.mjs` | The first read a module cannot express through Prisma |
| `extensions` | Extension points for tenant-specific apps (ADR-07) | The Objects and custom-apps phase |
| client address | `platform/http/client-address.ts`, the one reader of the socket address behind trusted proxies | The first feature that records or limits by client address (rate limits, audit) |

## Deviations from the template

- **Every unit of work is a transaction.** Mondapac (its ADR-0025) runs read-only work outside
  a transaction. Phoenix adds PostgreSQL row-level security (ADR-02), whose tenant setting is
  `SET LOCAL app.tenant_id` and lives only inside a transaction, so every unit opens one: a
  read-only unit runs `SET TRANSACTION READ ONLY` first and makes one attempt; a read-write unit
  retries up to three times on serialization failures and deadlocks (40001, 40P01).
- **Market became Tenant.** `tenant_id` is mandatory in every scoped table, key and foreign
  key, with no default tenant and no fallback; the `x-tenant-id` header names it on every
  tenant-scoped request; `HOSTED_TENANTS` lists the tenants of a deployment.
- **Market and vertical literal bans** became one tenant-literal ban, built from
  `config/tenants/*.json` (ids, locales, time zones).
- **`authz` (Phase 1, slice 1.1).** Ported from Mondapac `platform/authz` with these changes:
  - Scopes are `platform`, `tenant` and `site` (ADR-0004 decision 7 as amended by ADR-0018
    decision 6), not `platform` and `seller`; a scope names the population that may hold its
    keys (`platform-operator`, or `tenant-staff` for tenant and site keys). A portal user
    (ADR-0019) holds no key and no role: the gate refuses it under every `permissions` rule,
    and `GrantPolicy` refuses to grant it any role.
  - The gate itself refuses an unknown key (ADR-0004 decision 6) and a key outside the actor's
    population before it asks the authorisation check, so the permission registry is a gate
    input; Mondapac left both to identity's check.
  - There is no seller state: `whenSellerNotApproved`, `access.seller-not-approved` and their
    CI checks are gone, so the checked-in list `test/contracts/access-declarations.json` holds
    exactly the non-`permissions` rules. A rule's keys must be of one population (Mondapac: of
    one scope), so a rule may combine tenant and site keys.
  - The step-up guard and registry are not ported (Mondapac's seller OTP policy; MFA is
    Keycloak's, ADR-0004 decision 1). The `anonymous`/`system` over-HTTP list check is not
    ported yet: it reads controllers, and no module has one.
  - The role model (`GrantScope`, role scopes and kinds), `GrantPolicy` and `LastHolderPolicy`
    live in `platform/authz/roles/` until the identity module, which will own the Role and
    RoleAssignment aggregates, exists. A site grant carries `includeDescendants`; access flows
    only downward; a site grantor grants only within its own subtree.
  - Two ports have no implementation yet, each bound to a fail-closed placeholder:
    `AuthorisationCheck` (identity; every authenticated actor gets `access.unavailable`) and
    `SiteAncestryReader` (tenancy's `site_ancestry`; no site is within any subtree, so a
    subtree grant covers its own site only). `AuthzModule.register({ authorisation,
    siteAncestry })` takes the implementing modules. Organisation scoping waits for the
    tenancy module's Organization tree.
- **`placeholders` (slice 1.1).** Ported with `SiteAncestryReader` as its trigger, with only
  `@FailClosedPlaceholder`: Mondapac's `@PermissiveInterim` is not ported (ADR-0010 decisions 2
  and 3). A production start is refused while any placeholder is bound, and a start counts as
  non-production only when `NODE_ENV` is set explicitly to `development` or `test`. Until
  identity and tenancy bind their ports, the API and the worker refuse to start in production.
