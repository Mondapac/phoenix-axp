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
`FLOWABLE_REST_APP_ADMIN_PASSWORD` later does not change the stored password. The API reaches it
through `FLOWABLE_URL`, `FLOWABLE_USER` and `FLOWABLE_PASSWORD` (all three or none; required in
production; unset, engine commands wait). With `FLOWABLE_TEST_URL` and `FLOWABLE_TEST_PASSWORD`
set, `pnpm test:db` also runs the process bridge against that engine (CI always does).

`.env.example` sets `NODE_ENV=development`. Keep it set: while a port is bound to a fail-closed
placeholder (ADR-0010; today identity's authorisation check and tenancy's site-ancestry
reader), the API and the worker start only when `NODE_ENV` is explicitly `development` or
`test`, and refuse a production start.

Every tenant-scoped request names its tenant in the `x-tenant-id` header. There is no default
tenant: the tenants a deployment serves are `HOSTED_TENANTS`, each with a file in
`config/tenants/` (two fixtures: `demo-fa`, Persian/Jalali in Asia/Tehran, and `demo-en`,
English/Gregorian in America/Toronto).

### Studio (the tenant-staff panel)

`apps/studio` is a Next.js panel whose server is its BFF (`packages/panel-server`): the browser
talks to the studio's origin only, and the studio relays an allow-listed set of API routes with
`x-tenant-id` set from its own Host. Each studio host serves one tenant, named in
`STUDIO_TENANT_HOSTS` (no default; another host answers 404). For both fixtures locally:

```sh
pnpm --filter @phoenix/shared-kernel build
PHOENIX_API_URL=http://localhost:3000 \
STUDIO_TENANT_HOSTS="localhost:3001=demo-fa,demo-en.localhost:3001=demo-en" \
  pnpm --filter @phoenix/studio dev     # http://localhost:3001 and http://demo-en.localhost:3001
```

The API must list the studio origins in `PANEL_ORIGINS`, and staff sign-in needs Keycloak
(`KEYCLOAK_*`, `STUDIO_SIGN_IN_CALLBACK_URL` = the studio's `/auth/callback`). Every page reads
the member's session, permissions and the tenant's language from the API on each request; the
menu shows the entries of the keys the member holds, and the API still checks every call.

Screens: `/people/accounts` (staff accounts: add a local account, disable one, and per account
grant and revoke roles), `/people/roles` (roles; create a custom role and edit its keys),
`/structure/sites` (the site tree; per site: edit, move with its subtree, domains, subsites) and
`/structure/organizations` (the organization chart; per unit: rename, move, units below, its
sites). A
screen offers a change only when the member holds its key; a refusal of the API is shown in
place. `pnpm --filter @phoenix/studio test` runs the studio's specs (texts, the screens' rules,
dates and the session reads); the screens themselves are checked in a browser at 375, 768 and
1280 px, light and dark, on both tenant fixtures.

### Portal (the portal-user panel)

`apps/portal` is the portal users' Next.js panel, built like the studio (its own BFF relay and
`PORTAL_TENANT_HOSTS`). A visitor signs in, or signs up on first use, with a six-digit code sent
by email or SMS (ADR-0026); a tenant offers no method until a member holding
`identity.portal-sign-in.manage` opens one (`PUT /identity/portal-sign-in-settings`). Email
needs `SMTP_URL` and `MAIL_FROM` on the API; locally `SMS_PROVIDER=mail-relay` mails each SMS
through the same server. For both fixtures locally:

```sh
PHOENIX_API_URL=http://localhost:3000 \
PORTAL_TENANT_HOSTS="localhost:3002=demo-fa,demo-en.localhost:3002=demo-en" \
  pnpm --filter @phoenix/portal dev     # http://localhost:3002 and http://demo-en.localhost:3002
```

The API must list the portal origins in `PANEL_ORIGINS`. Screens: `/sign-in` (method, address,
code) and `/` ("My account": the masked addresses and sign-out). Behind a reverse proxy, set
`PANEL_PROXY_HOPS` on the portal and the portal's address in the API's `TRUSTED_PROXIES`, so the
rate limits count each visitor's network rather than the portal's. `pnpm --filter
@phoenix/portal test` runs the portal's specs; the screens are checked in a browser at 375, 768
and 1280 px, light and dark, on both tenant fixtures.

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
  definitions, immutable revisions with JSON Schema checked by Ajv, submission policy, retention;
  `process`: BPMN revisions checked by an intake allow-list, the bridge to Flowable with a lease
  relay, watermark sync and incidents). Every use case extends `UseCase` from `platform/authz` and declares a static
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
