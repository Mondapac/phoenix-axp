# ADR-0001: Repository Structure and Module Contract

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision; MondaPac code
is copied directly and adapted, decision D2)
**Relates to:** MondaPac ADR-0008 and ADR-0034 (source of this layout), ADR-0002, ADR-0003,
ADR-0006, ADR-0010, `docs/phases/phase-0-review.md`

## Context
Phoenix AXP is a multi-tenant DXP built by a team of more than twelve people in parallel
tracks. Module boundaries that are only a convention erode within weeks. MondaPac already runs
a modular monolith on the same stack (TypeScript, NestJS, PostgreSQL, Next.js, pnpm) whose
boundaries are enforced by code and CI; most of its `platform/` layer is domain-neutral.

## Decision
1. **pnpm workspace monorepo, modular monolith.**
   ```
   apps/api/                 NestJS; one app, APP_ROLE=api|worker (required, no default)
   apps/admin/               platform-operator panel (Next.js)
   apps/studio/              tenant-staff panel (Next.js)
   apps/portal/              portal-user portal (Next.js)
   packages/shared-kernel/   framework-free value types (Id, Clock, Result, TenantContext,
                             ActorContext, CallContext, CorrelationId)
   packages/ui/              design system components and tokens
   packages/panel-server/    BFF helpers shared by the panels
   prisma/schema/            one <module>.prisma per module (ADR-0003)
   config/                   configuration as code
   test/boundary-fixtures/   deliberately broken code proving each boundary rule fires
   ```
2. **Inside `apps/api/src`:** `modules/<bounded-context>/`, `platform/` (cross-cutting runtime),
   `extensions/` (extension point implementations).
3. **Module layers:** `domain/` (pure: no Nest, Prisma or I/O) → `application/use-cases` and
   `application/ports` → `infrastructure/` → `presentation/` (controllers, jobs, subscribers) →
   `contracts/` (facade, events, `permissions.ts`). `index.ts` exports only `contracts` and the
   Nest module.
4. **Communication:** reads through in-process facades; commands and reactions through domain
   events with the outbox (ADR-0006). No cross-module join, no reading another module's tables.
   Every facade call carries a `CallContext` (TenantContext, ActorContext, correlation id).
5. **Enforced in CI** (`pnpm boundaries`): dependency-cruiser rules (`domain-is-pure`,
   `module-public-api-only`, `use-cases-are-the-only-way-in`, `platform-does-not-import-modules`,
   `no-circular`), `check-prisma-boundaries` (table ownership, `tenant_id` required) and
   `check-panel-boundaries`.
6. **Green rule:** `pnpm verify` = typecheck + lint + boundaries + test + test:db + migration
   reversibility + licence check. CI runs exactly this; nothing is "done" without it.
7. **Provenance:** files copied from MondaPac keep a header comment naming the source path;
   Market is replaced by Tenant and Seller by Organization in the same change.

## Consequences
- Extraction of a module to a service later stays possible (Strangler Fig) without rewriting callers.
- Copying MondaPac code can carry marketplace concepts in; Ali (cto) reviews every copied file
  and the no-literal lint rule backs it up.
- Three panels mean three hosts and three BFFs; the shell is driven by configuration.

## Alternatives considered
- Microservices from day one: operational cost before the first pilot; rejected.
- A fresh layout instead of MondaPac's: loses tested boundary tooling; rejected (D2).
