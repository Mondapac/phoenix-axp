# Deferred platform components

ADR-0010 ("defer with a trigger"): no platform component is built before its first consumer, and
each one arrives at the latest in the same change as that consumer. Phase 0 ported from the
Mondapac template only what the skeleton itself uses. This table lists the rest and the
trigger that brings each one in. When a trigger fires, port the component from the template
(adapting Market to Tenant), add its boundary rules with a fixture each, and remove its row.

| Component | What it is | Trigger |
| --- | --- | --- |
| `events` and outbox (ADR-0006) | Event envelope, `defineEvent`, a `<module>.outbox` table per module, the relay in the worker (`FOR UPDATE SKIP LOCKED`), the in-process `EventBus`, `inbox` idempotency | The first module that publishes or consumes a domain event |
| `audit` (ADR-0015) | `platform.audit_log` (append-only by trigger), `AuditWriter` in the use-case transaction with a closed action catalogue, the hash-chain sealer in the worker, `audit-verify` | The first state-changing use case of a business module (and before any customer pilot) |
| `authz` (ADR-0004) | The use-case gate, permissions and roles per population, the `UseCase.execute` entry and its lint and dependency rules | The first business use case (identity, Phase 1) |
| identity integration (ADR-0004) | The `Authenticator` building `AuthenticatedActor` from a Keycloak session; `ActorGuard` accepts no session until then and answers 401 `session.invalid` to any `Authorization` header | The identity module, Phase 1 |
| `scheduler` (ADR-0006) | Fixed-interval jobs under `pg_try_advisory_xact_lock` in the worker | The first periodic job (the outbox relay or the audit sealer) |
| worker jobs | The worker today starts, logs a heartbeat and stops cleanly on SIGTERM | The first job or consumer (outbox relay, scheduler) |
| `storage` (ADR-0012) | The `ObjectStore` port and its SeaweedFS S3 adapter (SeaweedFS is already in `docker-compose.yml`) | The first feature that stores a file |
| `subject-keys` | Per-subject encryption keys for personal data fields, the key wrapper and its port | The first personal data field that must be erasable (identity or forms) |
| `ai` (ADR-0011) | `platform/ai/model-gateway`, the only caller of a model, with the provider SDK confined to that folder | Phase 5, the first AI feature |
| `mail` | The mail port and its SMTP adapter (Mailpit locally) | The first message sent to a person (identity verification) |
| `rate-limit` (ADR-0010) | Rate limits with `rate-limiter-flexible` on Valkey | The first public unauthenticated write (sign-in, sign-up) or before the first public deployment, whichever comes first |
| `i18n` | Message catalogues and locale negotiation against the tenant's `supportedLocales` | The first user-facing text produced by the API |
| reviewed raw reads (Mondapac ADR-0030) | `RawReadPort` and a closed, reviewed list of read-only statements for modules; today raw SQL is allowed only in the platform files of `RAW_SQL_FILES` in `scripts/check-prisma-boundaries.mjs` | The first read a module cannot express through Prisma |
| `placeholders` (Mondapac ADR-0031) | `@FailClosedPlaceholder` facades that always refuse; production refuses to start with one bound | The first facade a module depends on before it is built |
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
- **Row-level security binds the owner too.** Every tenant-scoped table has `ENABLE` and
  `FORCE ROW LEVEL SECURITY` and one policy to `phoenix_app` (migration 20261026120200,
  security review S2-1). The migration role owns the tables but matches no policy, so it sees
  and writes no tenant row; migrations are DDL only. A maintenance path that must cross
  tenants gets its own reviewed policy or role in its own migration; none exists today (see
  the data migration requirement below).

## Forward requirements (gates on later slices)

Requirements found by the reviews that belong to a slice not built yet. Each names the slice
it gates; that slice does not merge without it.

| Requirement | Why | Gate |
| --- | --- | --- |
| **Session tenant binding** (security review S2-3). Identity's `Authenticator` refuses a session whose tenant differs from the request's tenant (the one `TenantContextGuard` resolved from `x-tenant-id`), with a test on both tenant fixtures. Deployment (Helm, on-prem compose) keeps the API port reachable only from the BFFs; add a `HOST` setting so the API can bind a single interface (today `app.listen(port)` binds all). | `x-tenant-id` is trusted from any caller that reaches the API port (`tenant-context.guard.ts`). Today that only selects a tenant's anonymous surface; once sessions exist, user A of tenant X could send `x-tenant-id: Y` and act in Y. | The identity slice: no session is honoured before the check and its test exist. |
| **Composite hand-written foreign keys** (security review S2-4). Every foreign key written by hand in a migration between tenant-scoped tables includes `tenant_id` on both sides, as the Prisma-declared ones must (`check-prisma-boundaries`). | PostgreSQL checks a foreign key without row-level security, so an id-only key could point at another tenant's row. | Every migration review. |
| **Data migrations on tenant tables** (re-review N2-3). The first migration that reads or writes rows of a tenant-scoped table runs under its own reviewed role or policy, added in its own migration, and ADR-0020's per-tenant data migration line is amended to name it. | With `FORCE ROW LEVEL SECURITY` and every policy granted to `phoenix_app` only, the migration role matches no policy: a data migration under it silently reads and changes no row. | The first data migration on a tenant-scoped table. |
