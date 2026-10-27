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
| `authz` (ADR-03) | The use-case gate, permissions and roles per population, the `UseCase.execute` entry and its lint and dependency rules | The first business use case (identity, Phase 1) |
| identity integration (ADR-03) | The `Authenticator` building `AuthenticatedActor` from a Keycloak session; `ActorGuard` accepts no session until then and answers 401 `session.invalid` to any `Authorization` header | The identity module, Phase 1 |
| `scheduler` (ADR-05) | Fixed-interval jobs under `pg_try_advisory_xact_lock` in the worker | The first periodic job (the outbox relay or the audit sealer) |
| worker jobs | The worker today starts, logs a heartbeat and stops cleanly on SIGTERM | The first job or consumer (outbox relay, scheduler) |
| `subject-keys` | Per-subject encryption keys for personal data fields, the key wrapper and its port | The first personal data field that must be erasable (identity or forms) |
| `ai` (ADR-10) | `platform/ai/model-gateway`, the only caller of a model, with the provider SDK confined to that folder | Phase 5, the first AI feature |
| `mail` | The mail port and its SMTP adapter (Mailpit locally) | The first message sent to a person (identity verification) |
| `rate-limit` (ADR-11) | Rate limits with `rate-limiter-flexible` on Valkey | The first public unauthenticated write (sign-in, sign-up) or before the first public deployment, whichever comes first |
| `i18n` | Message catalogues and locale negotiation against the tenant's `supportedLocales` | The first user-facing text produced by the API |
| reviewed raw reads (Mondapac ADR-0030) | `RawReadPort` and a closed, reviewed list of read-only statements for modules; today raw SQL is allowed only in the platform files of `RAW_SQL_FILES` in `scripts/check-prisma-boundaries.mjs` | The first read a module cannot express through Prisma |
| `placeholders` (Mondapac ADR-0031) | `@FailClosedPlaceholder` facades that always refuse; production refuses to start with one bound | The first facade a module depends on before it is built |
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
- **Storage arrived ahead of its consumer.** The Phase 1 review lists `platform/storage` as its
  own slice (1.7), so it landed before the first module that stores a file. The first such
  module declares its `IntakePolicy`, keeps the file metadata in its own schema and issues
  signed URLs from a use case that checked permission and ownership (ADR-0012).
- **Market and vertical literal bans** became one tenant-literal ban, built from
  `config/tenants/*.json` (ids, locales, time zones).
