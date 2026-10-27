# ADR-0014: Runtime and Toolchain Baseline

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision, slice 0.3)
**Relates to:** MondaPac ADR-0014 and ADR-0021 (Node minimum 24.20.0), ADR-0001, ADR-0009

## Context
Copying MondaPac code directly is cheapest when the toolchain matches. On-prem and offline
installs need a pinned, mirrored toolchain.

## Decision
1. **Node.js 24.20.0 or later** (`engines` and `.nvmrc`); CI also runs the exact minimum.
2. **pnpm 10** workspaces (`packageManager` pinned); install scripts disabled by default.
3. **TypeScript 6**, strict, shared `tsconfig.base.json`.
4. **NestJS 12** for `apps/api`; **Next.js (App Router) with React 19** for panels.
5. **Prisma 7** with `@prisma/adapter-pg` (ADR-0003); **PostgreSQL 17**.
6. **Quality tools:** ESLint (flat config) and Prettier; Jest; dependency-cruiser; the licence
   checker (ADR-0009); GitHub Actions running `pnpm verify`.
7. **Local services** in Docker Compose: Postgres 17, Redis, mail catcher, Keycloak, Flowable
   REST, SeaweedFS.
8. **Upgrades** of a major version go through a small PR with `cto` approval; a minimum-version
   raise amends this ADR.

## Consequences
- Iran deployments need local npm and container mirrors (devops-engineer).
- Exact package versions are pinned by the lockfile in slice 0.3, not here.

## Alternatives considered
- Node 22 LTS: diverges from MondaPac's minimum and its copied code.
