# ADR-0003: Persistence — PostgreSQL 17 and Prisma 7 Schema-per-Module

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision)
**Relates to:** MondaPac ADR-0004, ADR-0025, ADR-0030, ADR-0002, ADR-0007

## Context
Phase 0 version 1 proposed Drizzle or Kysely. Copying MondaPac's persistence layer, tenant guard
and boundary checks directly requires the same ORM.

## Decision
1. **PostgreSQL 17**, **Prisma 7** with `@prisma/adapter-pg` and `multiSchema`: one PostgreSQL
   schema and one `prisma/schema/<module>.prisma` per module; no `@relation` across schemas.
2. **Columns:** UUIDv7 ids generated in the domain by `IdGenerator`; `timestamptz` values only
   from `Clock` (no SQL `now()`); `tenant_id` per ADR-0002; `version` on aggregate roots for
   optimistic locking — a stale write answers `409 conflict.stale`.
3. **Roles:** separate migrator and app roles; the app is not superuser, checks its role at
   start-up, and has only INSERT and SELECT on the audit table.
4. **UnitOfWork:** `run(tenant, work, {readOnly, isolation})` held in AsyncLocalStorage; it sets
   the RLS tenant setting. No HTTP, facade, hashing or model call inside a unit. Read-only units
   open no transaction (MondaPac ADR-0025).
5. **Raw SQL** only from two closed, reviewed statement lists (MondaPac ADR-0030); tagged
   templates only.
6. **Migrations:** each has a reviewed `down.sql`; CI runs up → down → up on a throwaway
   database. A merged migration is never edited.
7. **Redis** is a cache and coordination aid, never the source of truth.

## Consequences
- MondaPac's persistence code, `check-prisma-boundaries` and test harness transfer directly.
- Prisma's RLS support depends on per-transaction settings; validated in PoC 1.
- database-designer signs off every schema change, migration and RLS policy.

## Alternatives considered
- Drizzle or Kysely: lighter, but loses the copied guard and tooling.
- One shared schema: weaker ownership checks.
