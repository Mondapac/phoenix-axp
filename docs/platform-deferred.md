# Deferred platform components

ADR-0010 ("defer with a trigger"): no platform component is built before its first consumer, and
each one arrives at the latest in the same change as that consumer. Phase 0 ported from the
Mondapac template only what the skeleton itself uses. This table lists the rest and the
trigger that brings each one in. When a trigger fires, port the component from the template
(adapting Market to Tenant), add its boundary rules with a fixture each, and remove its row.

| Component | What it is | Trigger |
| --- | --- | --- |
| audit trail reader | Mondapac's `AuditTrailReader` (`platform/audit/audit-trail-reader.ts` and its Prisma reader): a paged, permission-checked read of a target's audit rows for an admin screen | The first screen or API that shows an audit trail |
| first `AUDIT_WRITER` binding | `PersistenceModule.auditWriterFor('<module>')` in a module's providers, its actions registered with `AuditActionCatalogue`, and the checked-in `test/contracts/audit-action-catalogue.snapshot.json` | The first state-changing use case of a business module (identity's role seed and grants) |
| identity integration (ADR-0004) | The `Authenticator` building `AuthenticatedActor` from a Keycloak session; `ActorGuard` accepts no session until then and answers 401 `session.invalid` to any `Authorization` header | The identity module, Phase 1 |
| `storage` (ADR-0012) | The `ObjectStore` port and its SeaweedFS S3 adapter (SeaweedFS is already in `docker-compose.yml`) | The first feature that stores a file |
| `subject-keys` | Per-subject encryption keys for personal data fields, the key wrapper and its port | The first personal data field that must be erasable (identity or forms) |
| `ai` (ADR-0011) | `platform/ai/model-gateway`, the only caller of a model, with the provider SDK confined to that folder | Phase 5, the first AI feature |
| `mail` | The mail port and its SMTP adapter (Mailpit locally) | The first message sent to a person (identity verification) |
| `rate-limit` (ADR-0010) | Rate limits with `rate-limiter-flexible` on Valkey | The first public unauthenticated write (sign-in, sign-up) or before the first public deployment, whichever comes first |
| `i18n` | Message catalogues and locale negotiation against the tenant's `supportedLocales` | The first user-facing text produced by the API |
| reviewed raw reads (Mondapac ADR-0030) | `RawReadPort` and a closed, reviewed list of read-only statements for modules; today raw SQL is allowed only in the platform files of `RAW_SQL_FILES` in `scripts/check-prisma-boundaries.mjs` | The first read a module cannot express through Prisma |
| `extensions` | Extension points for tenant-specific apps (ADR-0017, reserved) | The Objects and custom-apps phase |
| client address | `platform/http/client-address.ts`, the one reader of the socket address behind trusted proxies | The first feature that records or limits by client address (rate limits, audit) |

## Deviations from the template

- **Every unit of work is a transaction.** Mondapac (its ADR-0025) runs read-only work outside
  a transaction. Phoenix adds PostgreSQL row-level security (ADR-0002), whose tenant setting is
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
- **`events`, outbox, `scheduler` and the worker loops (slice 1.2).** Ported from Mondapac
  `platform/events`, `platform/scheduler`, `platform/persistence/outbox`,
  `platform/persistence/advisory-job-lock.ts` and `platform/worker`, Market adapted to Tenant,
  with these changes:
  - Every event, delivery and job carries exactly one `tenant_id`, and its handler or job runs
    as that tenant's system actor in a unit of that tenant. The inbox key is
    `(tenant_id, event_id, handler)` and the delivery key `(tenant_id, event_id, subscriber)`:
    ADR-0006 decision 5 names `(event_id, handler)`; the tenant leads every key (ADR-0002), so
    Mondapac's `EVENT_KEYED` exception to the leading-tenant rule is not needed.
  - The relay and the dispatcher work through the base client as the application login, so
    under row-level security every transaction they open sets `app.tenant_id` first, and each
    tenant is claimed in its own transaction. Mondapac's dispatcher ran its give-back, failure
    and dead-letter statements outside a transaction; Phoenix wraps each in one.
  - `unhostedMarketsWithRows` (a start-time warning about rows of tenants this deployment does
    not host) is not ported: the application login cannot see another tenant's rows. It is an
    operator query, as the migration role.
  - Timestamps are `timestamptz(3)`. The advisory-lock keys are hashed from `phoenix.job:<name>`.
  - The test-only `probe` schema (`prisma/schema/probe.prisma`: an outbox, an inbox and a
    receipt table, writable by no module) proves the event path end to end against PostgreSQL
    (`apps/api/test/db/event-path.db-spec.ts`) until a business module publishes. Remove it in
    the change that adds the first module outbox, together with its migration's tables.
  - `outbox` and `inbox` tables are reserved to `platform/persistence/outbox/` (the Prisma
    boundary check), and every module outbox must have the same columns.
- **`audit` (slice 1.3).** Ported from Mondapac `platform/audit`, `platform/persistence/audit`
  and the kernel's `canonical-json`, `content-hash` and `audit-action`, Market adapted to
  Tenant, with these changes:
  - `platform.audit_log`, `audit_log_seal` and `audit_chain_checkpoint` are under row-level
    security like every tenant table, forced on the owner too (migration 20261027150000,
    security review S5-3): the application login sees and writes only the rows of
    `app.tenant_id`, and the owner sees none. It holds `SELECT, INSERT` only, and a trigger
    refuses every `UPDATE`, `DELETE` and `TRUNCATE` (the owner too, unless it lifts FORCE and
    turns the user triggers off; see the forward requirements below).
  - The chain is per tenant: one chain, one watermark and one checkpoint series per tenant;
    the sealer and the verifier run per hosted tenant in a unit of that tenant.
  - A row carries one `tenant_id` and no market or "acting as" column (Mondapac's
    `market_id` and `acting_as_id`); neither is hashed. The hash tags are `PHOENIX-AUDIT-*-v1`,
    so no Mondapac golden hash applies; the golden values were computed independently.
  - No `money` value kind (no money in Phoenix yet). Personal data stays out of the row: the
    closed value kinds hold ids, enums, counts, instants, booleans and permission keys only,
    and the actor is an id with its type.
  - Timestamps are `timestamptz(3)`, so the column itself keeps whole milliseconds and
    Mondapac's `occurred_at` precision CHECK is not ported; the writer cuts the clock to
    milliseconds.
  - `audit-verify` does not check for bound placeholders (two are bound until identity and
    tenancy exist, and the command only reads).
  - The writer is bound by no module yet (no business module exists), so the action-catalogue
    contract test holds an empty snapshot and checks the catalogue mechanism only.
  - `audit_log`, `audit_log_seal` and `audit_chain_checkpoint` are reserved to
    `platform/persistence/audit/` (the Prisma boundary check), and a module reaches the writer
    only through the `AUDIT_WRITER` port, never the Prisma writer (dependency-cruiser).
- **Row-level security binds the owner too.** Every tenant-scoped table has `ENABLE` and
  `FORCE ROW LEVEL SECURITY` and one policy to `phoenix_app` (migrations 20261026120200 and
  20261027150000, security reviews S2-1 and S5-3). The migration role owns the tables but matches no policy, so it sees
  and writes no tenant row; migrations are DDL only. A maintenance path that must cross
  tenants gets its own reviewed policy or role in its own migration; none exists today. The
  database tests that use the owner as an operator or attacker (event path, audit chain, audit
  writer) run on copies where `global-setup.ts` lifts FORCE, as such an owner could.

## Forward requirements (gates on later slices)

Requirements found by the reviews that belong to a slice not built yet. Each names the slice
it gates; that slice does not merge without it.

| Requirement | Why | Gate |
| --- | --- | --- |
| **Session tenant binding** (security review S2-3). Identity's `Authenticator` refuses a session whose tenant differs from the request's tenant (the one `TenantContextGuard` resolved from `x-tenant-id`), with a test on both tenant fixtures. Deployment (Helm, on-prem compose) keeps the API port reachable only from the BFFs; add a `HOST` setting so the API can bind a single interface (today `app.listen(port)` binds all). | `x-tenant-id` is trusted from any caller that reaches the API port (`tenant-context.guard.ts`). Today that only selects a tenant's anonymous surface; once sessions exist, user A of tenant X could send `x-tenant-id: Y` and act in Y. | The identity slice: no session is honoured before the check and its test exist. |
| **Composite hand-written foreign keys** (security review S2-4). Every foreign key written by hand in a migration between tenant-scoped tables includes `tenant_id` on both sides, as the Prisma-declared ones must (`check-prisma-boundaries`). | PostgreSQL checks a foreign key without row-level security, so an id-only key could point at another tenant's row. | Every migration review. |
| **Site inputs from the database, and cross-tenant grants refused** (security review S5-7, QA review 5.8). Identity loads the target site in the actor's tenant (so row-level security makes another tenant's site "not found"), computes `siteRelation` from `site_ancestry` and never from input, implements the subtree check of `LastHolderPolicy.canActOn`, and refuses a grant across tenants; each with a test on both tenant fixtures. | `GrantPolicy` and site scope take `placement.scope.siteId`, `placement.siteRelation` and `grantCoversSite(siteId)` from the caller (`authz/roles/grant-policy.ts`, `authz/site-scope.ts`), and the tenant check sits in the unbuilt `AuthorisationCheck`. | The identity and tenancy slices that bind `AuthorisationCheck` and `SiteAncestryReader`. |
| **Stable subscriber names** (security review S5-8). Snapshot the subscriber names, as the event catalogue is snapshotted, so renaming a subscription fails CI instead of silently changing its inbox key. | The inbox and delivery keys carry the subscriber's name (`delivery-ledger.ts`): a renamed subscription would run its handler again for redelivered events. | The first business-module subscription. |
| **External audit anchor** (security review S5-2; Mondapac ADR-0032). Replace `LogAnchorSink` (`platform/audit/anchor-sink.ts`) with an anchor written to object storage under S3 Object Lock in compliance mode (SeaweedFS or the customer's store, ADR-0012), and bind a readable `AnchorSource` so `audit-verify` compares every checkpoint with its anchor (check f) instead of a manual runbook step. | Today the anchor is a log line nothing reads back. The hash chain is unkeyed SHA-256, so the database owner can rebuild seals and checkpoints into a consistent chain after rewriting rows; only an anchor outside its reach shows the rewrite. The code accepts the log anchor "while all data is synthetic": this row is that condition's tracked trigger. | **Before real data:** the first environment that holds non-synthetic data (a customer pilot, a staging copy of production data, or any on-prem install), whichever comes first. |
| **Migrator credential off runtime hosts** (security review S5-2). `MIGRATION_DATABASE_URL` exists only in the migration job (CI deploy step, Helm pre-upgrade hook, the offline installer's migrate step), never in the API's or worker's environment, image or mounted secrets; the deployment docs and charts say so and a release check (Bagher, release gate) confirms it. The API already refuses to start when the variable is set. | The migration role owns the tables: it can lift FORCE ROW LEVEL SECURITY, turn the audit triggers off and rewrite audit rows (confirmed by the review). A runtime host that holds it turns any code-execution bug into an audit rewrite. | **Before real data:** the first Helm chart or on-prem installer, and in any case before the first environment with non-synthetic data. |
| **Alert on a disabled audit trigger or lifted FORCE** (security review S5-2). A periodic check, in `audit-verify` or the role self-check, that fails and alerts when any of the six append-only triggers on `audit_log`, `audit_log_seal` and `audit_chain_checkpoint` has `pg_trigger.tgenabled <> 'O'`, or when a tenant-scoped table has `relforcerowsecurity = false`; wired to the operations alerting of the deployment. | Disabling a trigger or lifting FORCE is the first step of an owner-side rewrite; today nothing notices it, and `ALTER TABLE` leaves no row in the audit log. | **Before real data**, together with the external anchor; the alert route is part of the first production-like deployment. |
