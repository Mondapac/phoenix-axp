# Phoenix AXP

Agentic Experience Platform: a proprietary multi-tenant digital experience platform (DXP).
This repository is the backend: a NestJS modular monolith (`apps/api`, roles `api` and
`worker`) on PostgreSQL, with a framework-free shared kernel (`packages/shared-kernel`).
Licence: UNLICENSED (all rights reserved).

Phase 0 holds the skeleton and the platform foundations only: tenant and call contexts, clock,
ids, configuration, logging and HTTP hardening, health, and persistence with three tenant
isolation layers (a Prisma tenant guard, PostgreSQL row-level security set by the unit of work,
and silo deployments through `HOSTED_TENANTS`). Business modules come later; the platform pieces
that wait for their first consumer are listed in [docs/platform-deferred.md](docs/platform-deferred.md).

## Requirements

- Node.js >= 24.20.0 (`.nvmrc`) and pnpm 10.28.0 (`corepack enable`)
- Docker with Compose, for the local services

## Getting started

```sh
cp .env.example .env
docker compose up -d postgres     # or `docker compose up -d` for every local service
pnpm install
pnpm db:migrate
pnpm dev                          # API on http://localhost:3000, GET /health/ready
pnpm dev:worker                   # the worker role, in a second terminal
```

`.env.example` sets `NODE_ENV=development`. Keep it set: while a port is bound to a fail-closed
placeholder (ADR-0010; today identity's authorisation check and tenancy's site-ancestry
reader), the API and the worker start only when `NODE_ENV` is explicitly `development` or
`test`, and refuse a production start.

Every tenant-scoped request names its tenant in the `x-tenant-id` header. There is no default
tenant: the tenants a deployment serves are `HOSTED_TENANTS`, each with a file in
`config/tenants/` (two fixtures: `demo-fa`, Persian/Jalali in Asia/Tehran, and `demo-en`,
English/Gregorian in America/Toronto).

## Commands

| Command                   | What it does                                                    |
| ------------------------- | --------------------------------------------------------------- |
| `pnpm verify`             | Everything CI checks, in order (the commands below)             |
| `pnpm typecheck`          | TypeScript, every package                                       |
| `pnpm lint`               | ESLint (boundary rules included) and Prettier                   |
| `pnpm boundaries`         | dependency-cruiser and the Prisma schema and model-owner checks |
| `pnpm licences`           | Licence gate on production dependencies                         |
| `pnpm test`               | Unit and HTTP tests                                             |
| `pnpm test:db`            | Database tests (needs PostgreSQL and `MIGRATION_DATABASE_URL`)  |
| `pnpm db:check-reversible`| Every migration goes up, down and up again                      |
| `pnpm build`              | Builds the kernel and the API, then checks the built kernel     |
| `pnpm db:migrate:dev`     | Creates a migration from the schema; add its `down.sql` by hand |

## Layout

- `apps/api/src/platform/`: the platform layer; `apps/api/src/modules/`: business modules
  (none yet). Every use case extends `UseCase` from `platform/authz` and declares a static
  `access` rule (`permissions`, `anonymous`, `own-resources` or `system`); the `UseCaseGate`
  checks it on every entry, and `apps/api/test/authz/use-cases.spec.ts` fails a use case
  without one. Components not built yet, and their triggers, are in
  `docs/platform-deferred.md`. Boundaries are enforced by `eslint.config.mjs`,
  `apps/api/.dependency-cruiser.cjs` and `scripts/check-prisma-boundaries.mjs`, and proven by
  the fixtures in `apps/api/test/boundary-fixtures/`.
- `prisma/schema/`: one file and one PostgreSQL schema per module; `prisma/migrations/`.
- `config/tenants/`: tenant configuration.
- `docker-compose.yml`: PostgreSQL, Valkey, Mailpit, Keycloak, Flowable and SeaweedFS for local
  development.
