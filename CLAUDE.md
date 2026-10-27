# Project: Phoenix AXP — Agentic Experience Platform

Proprietary, multi-tenant Digital Experience Platform for organisations and government:
authenticated portals, a form builder, full BPMN process management, low-code Objects, websites,
and later commerce, personalisation and agentic AI. Delivered both on-premise (inside and outside
Iran) and as SaaS from ONE codebase.

Conventions are adapted from the MondaPac Marketplace Platform
(github.com/Mondapac/mondapac-marketplace-platform; owner decision 2026-10-26: copy directly,
adapt). "(MP ADR-xxxx)" means that repository's ADR. Accepted decisions: docs/adr/0001..0015,
0018 to 0021 (0018 to 0021 amend earlier ones; index: docs/adr/README.md). Follow them;
change one only through a new ADR or an "Amended by" note.

## Non-negotiables
- **Tenant is the first-class dimension** (MondaPac's Market rules applied to `tenant_id`,
  ADR-0002): every request, job and consumed event resolves to exactly one tenant; there is no
  default tenant; a deployment rejects tenants not in `HOSTED_TENANTS`. One tenant per ministry
  (or customer organisation); tenants share nothing. Site is a tree under Tenant (ADR-0018:
  closure table, sharing only inside the tenant); Organization (a separate tree) owns resources
  and scopes roles.
- **Three populations** with separate sign-in and sessions: `platform-operator` (platform team
  only), `tenant-staff`, `portal-user`. An operator is not a population: it is tenant-staff
  holding management roles, one account per employee; staff sign in with a directory (AD/LDAP)
  or a local account, as the tenant allows (ADR-0019).
- **No literals in the core:** never hardcode a tenant, organisation, content type, language or
  calendar. If you write `if (tenant === 'x')`, stop and flag it to `cto`: it belongs in
  configuration or an extension point.
- **Proprietary licence** (ADR-0009): dependencies must be MIT, Apache-2.0, BSD or ISC. GPL,
  AGPL, SSPL, BUSL and "sustainable use" licences are forbidden; CI checks licences.
- **No hard dependency on a foreign SaaS or cloud service:** every external service sits behind
  a port with a self-hosted adapter (offline installs must work).
- **In-house panel UI** (ADR-0016): `packages/ui` components on Base UI; no code, CSS, tokens,
  icons or assets from Metronic or any other template (look and page structure as reference only).
- **Persian and RTL from day one** (ADR-0008): logical CSS only, Jalali calendar, Persian digits,
  Persian text normalisation (ی/ي, ک/ك, ZWNJ) in search.

## Architecture (ADR-0001; MP ADR-0008, ADR-0034)
- MODULAR MONOLITH, NestJS + TypeScript, one app `apps/api` with `APP_ROLE=api|worker`
  (required, no default). Panels: `apps/admin` (platform operator), `apps/studio` (tenant
  staff), `apps/portal` (portal users), Next.js; `packages/shared-kernel`, `packages/ui`,
  `packages/panel-server` (BFF helpers); `prisma/schema/<module>.prisma`; `config/`.
- Module layout: `modules/<m>/{domain,application/{use-cases,ports},infrastructure,presentation/{jobs,subscribers},contracts}`;
  `index.ts` exports only `contracts` and the Nest module. `domain/` is pure (no Nest, Prisma or I/O).
- Modules talk only through facades (in-process reads) and domain events (outbox). No
  cross-module joins, no reading another module's tables, no importing another module's
  internals. Every facade call carries a `CallContext` (TenantContext + ActorContext + correlation id).
- `platform/` holds cross-cutting runtime (authz, call-context, tenant-context, clock, ids,
  unit-of-work, persistence, events, scheduler, worker, audit, subject-keys, i18n, mail,
  storage, rate-limit, http, health, ai, extensions). `platform` never imports a module.
- Deferral with triggers (ADR-0010): a platform piece lands no later than its first consumer,
  or at phase start when the phase review lists it (ADR-0020). Unbuilt facades bind to a
  `@FailClosedPlaceholder` that always refuses (allowed for a permission check too);
  production refuses to start with any bound.

## Persistence (ADR-0003, ADR-0002, ADR-0007)
- PostgreSQL 17, Prisma 7 with `@prisma/adapter-pg` and `multiSchema`: one DB schema per
  module, one `<module>.prisma` file.
- Isolation, three layers: Prisma tenant guard (`where.tenantId` must equal the unit's tenant)
  + PostgreSQL Row-Level Security, enabled and FORCEd on every tenant table + silo (separate
  database or on-prem deployment).
- UUIDv7 ids from `IdGenerator`; `timestamptz` from `Clock` only (no SQL `now()`); `version` on
  aggregate roots (stale write = `409 conflict.stale`); `tenant_id` leads every key and index,
  except a single-column UUIDv7 `@id` (ADR-0020).
- Separate migrator and app DB roles; the app is not superuser and checks its role at start-up;
  audit table is INSERT + SELECT only.
- UnitOfWork: every unit is a transaction, reads included; the tenant is set only with
  `set_config(..., true)` right after `BEGIN`, never at session level. PgBouncer only in
  transaction mode (ADR-0020). No HTTP, facade, hashing or model call inside a unit. Raw SQL
  only from the two reviewed statement lists.
- Every entity declares a versioning pattern: V1 revisions, V2 effective-dated, V3 snapshot at
  reference (form submissions keep form and process revision + hash), V4 append-only history.
- Personal data is encrypted under per-subject keys (`SubjectKeyService`); never in events,
  logs or audit values. Erasure = destroy the key.
- Every migration has a reviewed `down.sql`; CI runs up -> down -> up.

## Identity and authorisation (hybrid, ADR-0004; MP ADR-0018 for sessions and authz)
- Authentication: Keycloak (OIDC Authorization Code + PKCE) for SSO, LDAP/AD, SAML, MFA.
  Keycloak answers "who are you" only; it holds no roles or permissions. MFA is mandatory for
  administrators.
- After sign-in: opaque server-side session in PostgreSQL (only the SHA-256 of the token is
  stored), no session or permission cache, `__Host-` cookies (`SameSite=Strict` for admin),
  CSRF = HMAC of the session token + Origin check, one host per panel; the BFF sets
  `x-tenant-id` from the host. A role revoke or local-account disable applies on the next
  request; a directory (LDAP/AD) disable applies on the next request after the scheduled
  per-tenant sync, because Keycloak sends nothing for it (ADR-0020).
- Authorisation in the application layer: every use case extends `UseCase` and declares a
  static `access` rule (`permissions` | `anonymous` | `own-resources` | `system`). Silence is
  never a default: a use case without a rule fails CI. `UseCaseGate` runs before `handle`;
  controller guards only authenticate. Jobs and AI tools pass the same gate.
- A permission never grants a resource: check tenant, site and organisation ownership from the
  `ActorContext`, never from input; another owner's resource answers "not found".
- Permission keys `<module>.<resource>.<action>` live in `contracts/permissions.ts` and are
  registered in `platform/authz`; unknown keys grant nothing. Roles: system, default (versioned
  seed) and custom; `GrantPolicy`, `LastHolderPolicy`, protected keys. Role scopes: platform,
  tenant, site/organisation; a site grant is `thisSite` or `includeDescendants`, and access
  flows only downward (ADR-0018). Every permission change is audited.

## Processes and forms (ADR-0005, ADR-0007)
- Flowable OSS runs as a separate service. Only the `process` module talks to it, through a
  port. Core -> Flowable via outbox relay with idempotency keys; Flowable -> core via
  `process.inbox` keyed `(tenant_id, event_id, handler)`. The adapter passes the tenant on every
  call and re-checks every returned object (ADR-0020). Flowable executes processes, timers and
  DMN; the core owns task inbox, forms, authorisation and audit.
- Forms: JSON Schema + UI Schema; published revisions are immutable; each user task points to
  one form revision.

## Events and audit (ADR-0006, ADR-0015)
- Type `<module>.<subject>-<past-participle>.v<N>`; payloads via `defineEvent` with a closed
  field vocabulary (no free strings); events carry no actor; handlers run as the system actor.
- Per-module outbox, relay in the worker (`FOR UPDATE SKIP LOCKED`; a lease, not a row lock,
  across an external call), at-least-once delivery, per-module inbox keyed
  `(tenant_id, event_id, handler)` for idempotency (ADR-0020). Jobs must be safe to run twice.
- `platform.audit_log` is append-only, written in the use case's transaction from a closed
  action catalogue, sealed with a hash chain; `audit-verify` checks it.

## AI (ADR-0011; MP ADR-0019; not before Phase 5)
- Agentic means agents propose and draft; humans decide. Model output never decides, approves
  or rejects a task, changes a record or feeds an access check.
- One model entry point in `platform/ai`; provider SDKs are imported only there (CI-checked).
  Tools are READ or DRAFT, run as the calling user through the same gate; no AI service identity.
- Provider and model are tenant configuration with no default ("none" is valid; for Iran,
  "local model" or "none"). Every capability can be switched off per tenant and the non-AI
  path completes.

## Commands
- Requires Node.js 24.20.0+ and pnpm 10 (ADR-0014).
- `pnpm verify` = db:generate + typecheck + lint + boundaries + licences + test + test:db +
  db:check-reversible. CI runs exactly this. Run it before saying "done".
- `pnpm boundaries` = dependency-cruiser (`apps/api`) + `scripts/check-prisma-boundaries.mjs`;
  `apps/api/test/boundary-fixtures/` proves every rule fires. `check-panel-boundaries` comes
  with the first panel (frontend track).
- `pnpm licences` = the dependency licence gate (ADR-0009); `pnpm db:check-reversible` runs
  every migration up -> down -> up; `pnpm db:bootstrap` recreates the dev DB roles on an
  existing volume.
Update this section in the same PR when a script changes.

## Working rules for Claude
1. Plan before non-trivial work; present the plan and wait for approval.
2. Small vertical slices: one use case end to end (domain + persistence + API + tests).
3. Green before "done": typecheck, lint and tests (`pnpm verify`).
4. Tests first for domain logic (process state, form versioning, GrantPolicy).
5. Every domain and integration test runs against at least two tenant fixtures with different
   locale, calendar and time zone. A test that passes for one tenant only is a bug.
6. No `new Date()` / `Date.now()`; time comes from the injected `Clock` (Temporal, UTC, IANA zones).
7. Record significant decisions as ADRs in `docs/adr/` (context, decision, consequences,
   alternatives); change one only through a new ADR or an "Amended by" note. Reserve the
   number on the board first. When a decision changes a hard rule, update this file in the
   same change.
8. Code, comments, commits, ADRs, agents, skills and API docs in English. Playbooks, module
   briefs, feature docs, phase reviews and owner-facing reports in Persian. Address the owner
   as «صاحب پروژه»; never give the owner a team member's name.
9. Conventional Commits; one feature = one branch = one PR, cut from the latest `origin/main`.
10. Never commit secrets; document every variable in `.env.example`.
11. If a requirement is ambiguous or conflicts with an ADR, ask; do not guess. Never invent a
    business rule: what is not in the spec becomes an owner question.
12. New dependency = its own small PR with the licence stated.
13. **Phase review before building** (owner rule 0, ADR-0013): no phase starts without a joint
    review package in `docs/phases/phase-<n>-review.md`, a Persian summary for the owner,
    decisions asked one at a time as decision cards (team recommendation marked), answers
    recorded with date, and the owner's final decision on the whole phase. If scope or a hard
    rule changes mid-phase, stop and run a mini-review. Skill: `phoenix-phase-review`.
14. Module gates (ADR-0013): tier A = G1 + G2 + security review; tier B = one combined gate;
    tier C = product-owner approval. Tiers and the register: `docs/modules/README.md`.
    Skill: `phoenix-module-gate`.
15. Parallel tracks (`docs/process/parallel-tracks.md`): `backend`, `process`, `frontend`,
    `product`, each on its own branch and write area. The board is `docs/process/tracks.md`;
    read it at session start, update your own row at session end (skill
    `phoenix-track-session`). Shared files change only in a small PR announced on the board.
16. Push and merge model (owner decision 2026-10-27, ADR-0021): Claude pushes its branch and
    opens the PR. The thread that owns a PR merges it, coordinated by the project's coordinator
    session, only when CI is green on the head, the required reviews are recorded (combined
    QA + QC; security for the mandatory paths), the PR merges without conflicts and no blocker is
    open; it then tells the coordinator. Merge commits only, never squash. Never push to `main`
    directly, never force-push a pushed branch (merge `main` into it instead).
17. Skills: before producing output, check `docs/process/skills-map.md` and load the mapped
    skill. Project skills (`.claude/skills/`): `phoenix-repo-doc-change`, `phoenix-module-gate`,
    `phoenix-role-review`, `phoenix-track-session`, `phoenix-phase-review`. Project rules and
    ADRs take precedence over skill defaults.
18. Phase 0 PoCs are run-and-report only: results go to `docs/reviews/`; PoC code is not merged.

## Speed mode (owner decision 2026-10-26, active from day one; docs/process/speed-mode.md)
Until the owner lifts it:
- Coding runs on the cheaper model; the stronger model only for security review of sensitive paths.
- One fresh session per work package, handoff 5 KB max; no session lives longer than a day.
- CI is the main gate. One combined QA + QC review per batch of PRs; database-designer sign-off
  for schema changes is part of it. Security review stays mandatory on the paths under Team.
- One complete feature per PR (schema + use case + API + tests).
- No design documents beyond tier A briefs and gates; read existing docs by section (grep).
- Board and status docs updated once a day.
- No single-open-migration-PR rule: merge `main` into the branch right before merge (never rebase a pushed branch),
  regenerate the migration if needed; a merged migration is never edited.
- Figma-first is paused: UI from existing tokens and components; new components go in code first.
- At most four parallel tracks and one decision card per day for the owner (except the phase
  review day).
Speed never removes: tests, Definition of Done, security review of sensitive paths, and an
independent penetration test before real data.

## Team (subagents in .claude/agents/)
| Name | Role | Agent id | When |
|---|---|---|---|
| Ali | CTO | `cto` | cross-module conflicts, stack change, new dependency, ADRs |
| Hadi | Product Owner | `product-owner` | module briefs, stories, acceptance criteria |
| Mohammad | Software Architect | `software-architect` | domain model, state machines, module boundaries |
| Mojtaba | Database Designer | `database-designer` | physical schema, migrations, RLS; signs off EVERY schema change |
| Jafar | Product Designer | `product-designer` | multi-step, multi-actor flows |
| Reza | UI/UX Designer | `ui-ux-designer` | screen specs, tokens, RTL, accessibility |
| Hossein | Backend Developer | `backend-developer` | backend vertical slices |
| Mahdi | Frontend Developer | `frontend-developer` | panels and portal from spec and API |
| Sajad | QA Engineer | `qa-engineer` | independent tests; read-and-test |
| Hassan | Security Tester | `security-tester` | mandatory security review; read-only |
| Bagher | QC / Release Manager | `qc-release-manager` | final gate before merge or phase close |
| Kazem | DevOps Engineer | `devops-engineer` | CI/CD, Docker, Helm, offline installer |
| Javad | Scrum Master | `scrum-master` | process health, risks, retros; advisory |

When the owner refers to a member by name, route to that agent id. See TEAM-PLAYBOOK-fa.md.
- Design order: product-owner -> software-architect (-> product-designer/ui-ux-designer for
  user-facing work) before backend-developer/frontend-developer implement.
- database-designer turns the domain model into the physical schema before a migration is
  written and signs off every Prisma schema change, migration and RLS policy.
- security-tester review is MANDATORY on: identity (Keycloak, session, cookie/CSRF);
  authorisation (`platform/authz`, roles, GrantPolicy); tenant isolation (tenant guard, RLS,
  silo routing); raw SQL; the process/Flowable bridge; file intake and personal data; every AI
  surface. A Critical or High finding there blocks merge.
- qa-engineer and security-tester are read-only reviewers; findings go back to the implementer.
- qc-release-manager is the final gate before merge and before a phase closes.
- Disagreement or an unclear boundary goes to `cto`.
- scrum-master is advisory and writes only under `docs/project/`.

## Definition of Ready (every module, ADR-0013)
- Brief (`docs/modules/_template/brief.md`) with scope by feature ID, hard rules, data
  ownership, owner decisions answered, risks and acceptance criteria.
- G1 approved; for tier A, G2 approved too; dated in the brief and in `docs/modules/README.md`.
- The module's phase has passed its phase review (rule 13).

## Definition of Done (every slice)
- Unit + at least one integration test pass, on two tenant fixtures; migrations reversible.
- OpenAPI updated; structured logging with correlation id.
- `access` rule declared; tenant and ownership checked; input validated.
- UI only from library components and tokens; RTL verified.
- Docs note if behaviour or architecture changed.
- `pnpm verify` green.
