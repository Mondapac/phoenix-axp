# ADR-0002: Tenant as the First-Class Dimension and Three-Layer Isolation

**Status:** Accepted — 2026-10-26 (owner decision: concept mapping and all three isolation
layers approved in the Phase 0 review)
**Relates to:** MondaPac ADR-0002 (Market as first-class dimension), MondaPac ADR-0003
(regional deployment), ADR-0001, ADR-0003, ADR-0004

## Context
In MondaPac, Market is the mandatory dimension and `tenant_id` is a seam without isolation. In
Phoenix AXP the tenant is a real security boundary: government tenants must never see each
other's data, and some require a separate database or an on-premise installation.

## Decision
1. **Concept mapping.** MondaPac Market → **Tenant** (`tenant_id`); new level **Site** under
   Tenant (a site or portal); Seller → **Organization** (a tree that owns resources and scopes
   roles); populations customer/seller/admin → **platform-operator / tenant-staff /
   portal-user**, each with its own sign-in and sessions; Vertical → content types, Objects and
   extensions; Region Stack and `HOSTED_MARKETS` → **Deployment** (on-prem or SaaS) and
   `HOSTED_TENANTS`.
   *(Amended by ADR-0018: Site is a tree under the tenant, with content sharing inside the tenant.)*
2. **Mandatory context.** Every request, job and consumed event resolves to exactly one tenant.
   There is no default tenant. A deployment rejects any tenant not in `HOSTED_TENANTS`. The BFF
   derives `x-tenant-id` from the host only.
3. **Data.** Every tenant-scoped table has `tenant_id` (not null, no default) leading every
   index and unique key.
4. **Layer 1 — tenant guard** (MondaPac market guard): Prisma extension rejecting any query whose
   `where.tenantId` differs from the unit of work's tenant; nested writes and raw SQL are closed
   to modules.
5. **Layer 2 — PostgreSQL Row-Level Security** on every tenant-scoped table, keyed on a
   per-transaction setting written by the UnitOfWork; the app role cannot bypass RLS. Defence in
   depth, not a replacement for layer 1.
6. **Layer 3 — silo.** A tenant may get its own database, or its own on-prem deployment with
   `HOSTED_TENANTS` naming only it. Code paths are identical.
7. **No literals.** Core code never branches on a tenant or organisation identity; differences
   live in configuration or extension points. Lint enforces it.
8. **Tests** run on at least two tenant fixtures with different locale, calendar and time zone.

## Consequences
- RLS with Prisma and connection pooling (PgBouncer) is a risk; PoC 1 (slice 0.6) measures leak
  = 0 and overhead < 15% with 1000 tenants before any module code.
- Every module design states its tenant, site and organisation scope.

## Alternatives considered
- Guard only (MondaPac): insufficient for a security boundary.
- Schema-per-tenant: migration and pool cost at 1000+ tenants; silo covers the strict cases.
