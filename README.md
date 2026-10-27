# Phoenix AXP

Agentic Experience Platform: a proprietary multi-tenant digital experience platform (DXP).
This repository is the backend: a NestJS modular monolith (`apps/api`, roles `api` and
`worker`) on PostgreSQL, with a framework-free shared kernel (`packages/shared-kernel`).
Licence: UNLICENSED (all rights reserved).

Phase 0 holds the skeleton and the platform foundations: tenant and call contexts, clock,
ids, configuration, logging and HTTP hardening, health, and persistence with three tenant
isolation layers (a Prisma tenant guard, PostgreSQL row-level security set by the unit of work,
and silo deployments through `HOSTED_TENANTS`). Phase 1 adds use-case authorisation
(`platform/authz`), domain events with a per-module outbox and inbox, the scheduler, and an
append-only audit log with a per-tenant hash chain (`platform/audit`); the worker role runs
the outbox relay, the event dispatcher and the scheduled jobs, the audit sealer and verifier
among them. Business modules come later; the platform pieces
that wait for their first consumer are listed in [docs/platform-deferred.md](docs/platform-deferred.md).

## Requirements

- Node.js >= 24.20.0 (`.nvmrc`) and pnpm 10.28.0 (`corepack enable`)
- Docker with Compose, for the local services

## Getting started

```sh
cp .env.example .env
docker compose up -d postgres seaweedfs   # or `docker compose up -d` for every service
pnpm install
pnpm db:migrate
pnpm dev                          # API on http://localhost:3000, GET /health/ready
pnpm dev:worker                   # the worker role, in a second terminal
```

The database roles (`phoenix_migrator`, `phoenix_api` in group `phoenix_app`) come from
`scripts/db/bootstrap-dev.sql`, which the Postgres container runs once on a fresh volume. On a
volume created before that file, or after it changes, run `pnpm db:bootstrap`; a migration or
start-up error about a missing role means exactly this.

Flowable (the process engine, slice 2.1) runs from Phoenix's image in `infra/flowable/` on its
own database and login `flowable`, created by `scripts/db/bootstrap-flowable-dev.sql`; on an
older volume `pnpm db:bootstrap` creates them. `docker compose up -d flowable` builds the image;
`FLOWABLE_PASSWORD=phoenix-dev-flowable pnpm flowable:check` probes it (health, a timer, the
tenant on history). Flowable creates its admin user on the first start only: changing
`FLOWABLE_REST_APP_ADMIN_PASSWORD` later does not change the stored password.

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
| `pnpm lint`               | ESLint (boundary rules included), Prettier and the four-digit ADR reference check |
| `pnpm boundaries`         | dependency-cruiser, the Prisma schema and model-owner checks, and the own-module binding check |
| `pnpm licences`           | Licence gate (ADR-0009) on the full dependency tree; reviewed exceptions in `config/licence-exceptions.json` |
| `pnpm test`               | Unit and HTTP tests                                             |
| `pnpm test:db`            | Database tests (needs PostgreSQL and `MIGRATION_DATABASE_URL`)  |
| `pnpm test:storage`       | Object storage tests (needs SeaweedFS and the `S3_*` key)       |
| `pnpm db:check-reversible`| Every migration goes up, down and up again                      |
| `pnpm build`              | Builds the kernel and the API, then checks the built kernel     |
| `pnpm db:migrate:dev`     | Creates a migration from the schema; add its `down.sql` by hand |

To verify a tenant's audit chain by hand (after `pnpm build`; exit 0 clean, 1 refused, 2 findings):

```sh
APP_ROLE=api node apps/api/dist/audit-verify.js --tenant <id> [--full]
```

Operator commands run one use case as the tenant's system actor (exit 0 success, 1 refused, 3
failed; a command adds its own codes). The first administrator of a new tenant (refused once the
tenant has an active administrator; exit 0 granted, 2 pending):

1. Run it with `--username`. An unknown username gets a local account; it prints the account id.
   A directory (AD/LDAP) administrator signs in once before this step, so the account is theirs.
2. The person signs in to studio. Confirm with them that they did (the realm must not allow
   self-registration), then run it again with `--account <id>` from step 1 to grant.

```sh
APP_ROLE=api node apps/api/dist/run-command.js identity.bootstrap-tenant-admin --tenant <id> --username <name> [--account <id>]
```

## Layout

- `apps/api/src/platform/`: the platform layer; `apps/api/src/modules/`: business modules
  (`tenancy`: site tree, organization chart, site domains, tenant settings; `forms`: form
  definitions, immutable revisions with JSON Schema checked by Ajv, submission policy, retention). Every use case extends `UseCase` from `platform/authz` and declares a static
  `access` rule (`permissions`, `anonymous`, `own-resources` or `system`); the `UseCaseGate`
  checks it on every entry, and `apps/api/test/authz/use-cases.spec.ts` fails a use case
  without one. A use case appends its events to its module's outbox through the `OutboxWriter`
  that `PersistenceModule.outboxWriterFor(module)` binds; a consuming use case opens
  `UnitOfWork.runOnce`, which records the module inbox row so a repeated delivery does no work
  twice. Components not built yet, and their triggers, are in
  `docs/platform-deferred.md`. Boundaries are enforced by `eslint.config.mjs`,
  `apps/api/.dependency-cruiser.cjs` and `scripts/check-prisma-boundaries.mjs`, and proven by
  the fixtures in `apps/api/test/boundary-fixtures/`.
- `prisma/schema/`: one file and one PostgreSQL schema per module; `prisma/migrations/`.
- `config/tenants/`: tenant configuration.
- `docker-compose.yml`: PostgreSQL, Valkey, Mailpit, Keycloak, Flowable and SeaweedFS for local
  development.
