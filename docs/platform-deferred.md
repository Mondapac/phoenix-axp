# Deferred platform components

ADR-0010 ("defer with a trigger"): no platform component is built before its first consumer, and
each one arrives at the latest in the same change as that consumer. Phase 0 ported from the
Mondapac template only what the skeleton itself uses. This table lists the rest and the
trigger that brings each one in. When a trigger fires, port the component from the template
(adapting Market to Tenant), add its boundary rules with a fixture each, and remove its row.

| Component | What it is | Trigger |
| --- | --- | --- |
| audit trail reader | Mondapac's `AuditTrailReader` (`platform/audit/audit-trail-reader.ts` and its Prisma reader): a paged, permission-checked read of a target's audit rows for an admin screen | The first screen or API that shows an audit trail |
| first `AUDIT_WRITER` binding | `PersistenceModule.auditWriterFor('<module>')` in a module's providers, its actions registered with `AuditActionCatalogue`, and the checked-in `test/contracts/audit-action-catalogue.snapshot.json` | The first state-changing use case of a business module (identity's role seed and grants) |
| `ai` (ADR-0011) | `platform/ai/model-gateway`, the only caller of a model, with the provider SDK confined to that folder | Phase 5, the first AI feature |
| `i18n` | Message catalogues as data (ADR-0022 decision 3) and locale negotiation against the tenant's `supportedLocales`. Slice 1.8 sends the first API-made text, the sign-in code message, from a Persian and English table in `identity/application/portal/portal-messages.ts` | The next work package after slice 1.8 (phase 1 review); it moves that table into the catalogue |
| SMS provider | An `SmsSender` adapter for a real SMS gateway (`platform/sms`, ADR-0026 decision 6). Today `SMS_PROVIDER` is `none` (mobile sign-in stays closed) or the development-only `mail-relay` | The owner naming a provider, before a tenant opens mobile sign-in in production |
| reviewed raw reads (Mondapac ADR-0030) | `RawReadPort` and a closed, reviewed list of read-only statements for modules; today raw SQL is allowed only in the platform files of `RAW_SQL_FILES` in `scripts/check-prisma-boundaries.mjs` | The first read a module cannot express through Prisma |
| `extensions` | Extension points for tenant-specific apps (ADR-0017, reserved) | The Objects and custom-apps phase |

## Deviations from the template

- **Rate limits on PostgreSQL, not Valkey (slice 2.5).** `platform/rate-limit` keeps fixed
  windows in `platform.rate_limit_window` (tenant first, row-level security, pruned by a job)
  instead of `rate-limiter-flexible` on Valkey: no new service or dependency for the first
  public write, and offline installs gain nothing to run. The bucket is an HMAC of the rule and
  the subject (account or address), so no address is stored. Move to Valkey behind the same
  `RateLimiter` port if the write load of the limits shows on PostgreSQL.
- **`subject-keys` (slice 2.5).** AES-256-GCM per subject, each key wrapped under
  `SUBJECT_KEY_KEK` with the tenant and subject bound as associated data; erasure clears the
  wrapped key. A KEK rotation (re-wrapping every key) is not built yet.
- **Mail without a library (slice 1.8).** `platform/mail` speaks SMTP itself (`smtp-client.ts`:
  EHLO, STARTTLS, AUTH PLAIN, one message per connection) on `node:net` and `node:tls`, instead
  of the template's mail library: one sign-in code per message needs nothing more, and no new
  dependency or licence exception. STARTTLS is required in production.
- **Client address through `trust proxy` (slice 1.8).** No `platform/http/client-address.ts`:
  `TRUSTED_PROXIES` sets Express's `trust proxy` to the panels' addresses, so `req.ip` is the
  browser's address the BFF forwarded (`PANEL_PROXY_HOPS` in `packages/panel-server`), and the
  socket's address otherwise.
- **CAPTCHA (slice 2.5).** A self-hosted proof of work in ALTCHA's wire format
  (`platform/captcha`), signed with a key derived from `SESSION_SECRET`; each solved challenge
  is spent once per tenant (`platform.captcha_spent`).

- **Every unit of work is a transaction.** Mondapac (its ADR-0025) runs read-only work outside
  a transaction. Phoenix adds PostgreSQL row-level security (ADR-0002), whose tenant setting is
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
- **`authz` (Phase 1, slice 1.1).** Ported from Mondapac `platform/authz` with these changes:
  - Scopes are `platform`, `tenant` and `site` (ADR-0004 decision 7 as amended by ADR-0018
    decision 6), not `platform` and `seller`; a scope names the population that may hold its
    keys (`platform-operator`, or `tenant-staff` for tenant and site keys). A portal user
    (ADR-0019) holds no key and no role: the gate refuses it under every `permissions` rule,
    and `GrantPolicy` refuses to grant it any role.
  - The gate itself refuses an unknown key (ADR-0004 decision 6) and a key outside the actor's
    population before it asks the authorisation check, so the permission registry is a gate
    input; Mondapac left both to identity's check.
  - There is no seller state: `whenSellerNotApproved`, `access.seller-not-approved` and their
    CI checks are gone, so the checked-in list `test/contracts/access-declarations.json` holds
    exactly the non-`permissions` rules. A rule's keys must be of one population (Mondapac: of
    one scope), so a rule may combine tenant and site keys.
  - The step-up guard and registry are not ported (Mondapac's seller OTP policy; MFA is
    Keycloak's, ADR-0004 decision 1). The `anonymous`/`system` over-HTTP list check is not
    ported yet: it reads controllers, and no module has one.
  - The role model (`GrantScope`, role scopes and kinds), `GrantPolicy` and `LastHolderPolicy`
    live in `platform/authz/roles/` until the identity module, which will own the Role and
    RoleAssignment aggregates, exists. A site grant carries `includeDescendants`; access flows
    only downward; a site grantor grants only within its own subtree. Since slice 1.5 the
    identity module owns the `role` and `role_assignment` tables; the pure types and policies
    stay here, because `site-scope.ts` needs `GrantScope` and `platform/` imports no module.
  - Two ports have no implementation yet, each bound to a fail-closed placeholder:
    `AuthorisationCheck` (identity; every authenticated actor gets `access.unavailable`) and
    `SiteAncestryReader` (tenancy's `site_ancestry`; no site is within any subtree, so a
    subtree grant covers its own site only). `AuthzModule.register({ authorisation,
    siteAncestry })` takes the implementing modules. Organisation scoping waits for the
    tenancy module's Organization tree. Since slices 1.4 and 1.5, tenancy binds the reader and
    identity binds the check and a third port, the `Authenticator` of the `ActorGuard`
    (`AuthzModule.register({ authentication, authorisation, siteAncestry })`): no authz
    placeholder stays bound.
- **`placeholders` (slice 1.1).** Ported with `SiteAncestryReader` as its trigger, with only
  `@FailClosedPlaceholder`: Mondapac's `@PermissiveInterim` is not ported (ADR-0010 decisions 2
  and 3). A production start is refused while any placeholder is bound, and a start counts as
  non-production only when `NODE_ENV` is set explicitly to `development` or `test`. Until
  identity and tenancy bind their ports, the API and the worker refuse to start in production.
- **`events`, outbox, `scheduler` and the worker loops (slice 1.2).** Ported from Mondapac
  `platform/events`, `platform/scheduler`, `platform/persistence/outbox`,
  `platform/persistence/advisory-job-lock.ts` and `platform/worker`, Market adapted to Tenant,
  with these changes:
  - Every event, delivery and job carries exactly one `tenant_id`, and its handler or job runs
    as that tenant's system actor in a unit of that tenant. The inbox key is
    `(tenant_id, event_id, handler)` and the delivery key `(tenant_id, event_id, subscriber)`:
    ADR-0006 decision 5 names `(event_id, handler)`; the tenant leads every key (ADR-0002), so
    Mondapac's `EVENT_KEYED` exception to the leading-tenant rule is not needed.
  - The relay and the dispatcher work through the base client as the application login, so
    under row-level security every transaction they open sets `app.tenant_id` first, and each
    tenant is claimed in its own transaction. Mondapac's dispatcher ran its give-back, failure
    and dead-letter statements outside a transaction; Phoenix wraps each in one.
  - `unhostedMarketsWithRows` (a start-time warning about rows of tenants this deployment does
    not host) is not ported: the application login cannot see another tenant's rows. It is an
    operator query, as the migration role.
  - Timestamps are `timestamptz(3)`. The advisory-lock keys are hashed from `phoenix.job:<name>`.
  - The test-only `probe` schema (`prisma/schema/probe.prisma`: an outbox, an inbox and a
    receipt table, writable by no module) proves the event path end to end against PostgreSQL
    (`apps/api/test/db/event-path.db-spec.ts`) until a business module publishes. Remove it in
    the change that adds the first module outbox, together with its migration's tables.
  - `outbox` and `inbox` tables are reserved to `platform/persistence/outbox/` (the Prisma
    boundary check), and every module outbox must have the same columns.
- **`audit` (slice 1.3).** Ported from Mondapac `platform/audit`, `platform/persistence/audit`
  and the kernel's `canonical-json`, `content-hash` and `audit-action`, Market adapted to
  Tenant, with these changes:
  - `platform.audit_log`, `audit_log_seal` and `audit_chain_checkpoint` are under row-level
    security like every tenant table, forced on the owner too (migration 20261027150000,
    security review S5-3): the application login sees and writes only the rows of
    `app.tenant_id`, and the owner sees none. It holds `SELECT, INSERT` only, and a trigger
    refuses every `UPDATE`, `DELETE` and `TRUNCATE` (the owner too, unless it lifts FORCE and
    turns the user triggers off; see the forward requirements below).
  - The chain is per tenant: one chain, one watermark and one checkpoint series per tenant;
    the sealer and the verifier run per hosted tenant in a unit of that tenant.
  - A row carries one `tenant_id` and no market or "acting as" column (Mondapac's
    `market_id` and `acting_as_id`); neither is hashed. The hash tags are `PHOENIX-AUDIT-*-v1`,
    so no Mondapac golden hash applies; the golden values were computed independently.
  - No `money` value kind (no money in Phoenix yet). Personal data stays out of the row: the
    closed value kinds hold ids, enums, counts, instants, booleans and permission keys only,
    and the actor is an id with its type.
  - Timestamps are `timestamptz(3)`, so the column itself keeps whole milliseconds and
    Mondapac's `occurred_at` precision CHECK is not ported; the writer cuts the clock to
    milliseconds.
  - `audit-verify` does not check for bound placeholders (two are bound until identity and
    tenancy exist, and the command only reads).
  - The writer is bound by no module yet (no business module exists), so the action-catalogue
    contract test holds an empty snapshot and checks the catalogue mechanism only.
  - `audit_log`, `audit_log_seal` and `audit_chain_checkpoint` are reserved to
    `platform/persistence/audit/` (the Prisma boundary check), and a module reaches the writer
    only through the `AUDIT_WRITER` port, never the Prisma writer (dependency-cruiser).
- **Row-level security binds the owner too.** Every tenant-scoped table has `ENABLE` and
  `FORCE ROW LEVEL SECURITY` and one policy to `phoenix_app` (migrations 20261026120200 and
  20261027150000, security reviews S2-1 and S5-3). The migration role owns the tables but matches no policy, so it sees
  and writes no tenant row; migrations are DDL only. A maintenance path that must cross
  tenants gets its own reviewed policy or role in its own migration; none exists today (see
  the data migration requirement below). The database tests that use the owner as an operator
  or attacker (event path, audit chain, audit writer) run on copies where `global-setup.ts`
  lifts FORCE, as such an owner could.

## Forward requirements (gates on later slices)

Requirements found by the reviews that belong to a slice not built yet. Each names the slice
it gates; that slice does not merge without it.

| Requirement | Why | Gate |
| --- | --- | --- |
| **Session tenant binding** (security review S2-3). Done in slice 1.5 for the code: identity's `Authenticator` looks a session up in the request's tenant only, so another tenant's session is not found (test/db/identity.db-spec.ts, both fixtures), and `HOST` binds the API to one interface. Still open: deployment (Helm, on-prem compose) keeps the API port reachable only from the BFFs and sets `HOST`. | `x-tenant-id` is trusted from any caller that reaches the API port (`tenant-context.guard.ts`). Today that only selects a tenant's anonymous surface; once sessions exist, user A of tenant X could send `x-tenant-id: Y` and act in Y. | The identity slice: no session is honoured before the check and its test exist. |
| **Composite hand-written foreign keys** (security review S2-4). Every foreign key written by hand in a migration between tenant-scoped tables includes `tenant_id` on both sides, as the Prisma-declared ones must (`check-prisma-boundaries`). | PostgreSQL checks a foreign key without row-level security, so an id-only key could point at another tenant's row. | Every migration review. |
| **Site inputs from the database, and cross-tenant grants refused** (security review S5-7, QA review 5.8). Identity loads the target site in the actor's tenant (so row-level security makes another tenant's site "not found"), computes `siteRelation` from `site_ancestry` and never from input, implements the subtree check of `LastHolderPolicy.canActOn`, and refuses a grant across tenants; each with a test on both tenant fixtures. | `GrantPolicy` and site scope take `placement.scope.siteId`, `placement.siteRelation` and `grantCoversSite(siteId)` from the caller (`authz/roles/grant-policy.ts`, `authz/site-scope.ts`), and the tenant check sits in the unbuilt `AuthorisationCheck`. | The identity and tenancy slices that bind `AuthorisationCheck` and `SiteAncestryReader`. **Slice 1.6:** a site grant's site must exist in the actor's tenant (`SiteAncestryReader.siteExists`, under row-level security) and `siteRelation` comes from `site_ancestry`. Still open: the subtree check of `canActOn` for a site actor acting on an account (no such use case yet: disabling needs a tenant key). |
| **Stable subscriber names** (security review S5-8). Snapshot the subscriber names, as the event catalogue is snapshotted, so renaming a subscription fails CI instead of silently changing its inbox key. | The inbox and delivery keys carry the subscriber's name (`delivery-ledger.ts`): a renamed subscription would run its handler again for redelivered events. | The first business-module subscription. |
| **External audit anchor** (security review S5-2; Mondapac ADR-0032). Replace `LogAnchorSink` (`platform/audit/anchor-sink.ts`) with an anchor written to object storage under S3 Object Lock in compliance mode (SeaweedFS or the customer's store, ADR-0012), and bind a readable `AnchorSource` so `audit-verify` compares every checkpoint with its anchor (check f) instead of a manual runbook step. | Today the anchor is a log line nothing reads back. The hash chain is unkeyed SHA-256, so the database owner can rebuild seals and checkpoints into a consistent chain after rewriting rows; only an anchor outside its reach shows the rewrite. The code accepts the log anchor "while all data is synthetic": this row is that condition's tracked trigger. | **Before real data:** the first environment that holds non-synthetic data (a customer pilot, a staging copy of production data, or any on-prem install), whichever comes first. |
| **Migrator credential off runtime hosts** (security review S5-2). `MIGRATION_DATABASE_URL` exists only in the migration job (CI deploy step, Helm pre-upgrade hook, the offline installer's migrate step), never in the API's or worker's environment, image or mounted secrets; the deployment docs and charts say so and a release check (Bagher, release gate) confirms it. The API already refuses to start when the variable is set. | The migration role owns the tables: it can lift FORCE ROW LEVEL SECURITY, turn the audit triggers off and rewrite audit rows (confirmed by the review). A runtime host that holds it turns any code-execution bug into an audit rewrite. | **Before real data:** the first Helm chart or on-prem installer, and in any case before the first environment with non-synthetic data. |
| **Alert on a disabled audit trigger or lifted FORCE** (security review S5-2). A periodic check, in `audit-verify` or the role self-check, that fails and alerts when any of the six append-only triggers on `audit_log`, `audit_log_seal` and `audit_chain_checkpoint` has `pg_trigger.tgenabled <> 'O'`, or when a tenant-scoped table has `relforcerowsecurity = false`; wired to the operations alerting of the deployment. | Disabling a trigger or lifting FORCE is the first step of an owner-side rewrite; today nothing notices it, and `ALTER TABLE` leaves no row in the audit log. | **Before real data**, together with the external anchor; the alert route is part of the first production-like deployment. |
| **Data migrations on tenant tables** (re-review N2-3). The first migration that reads or writes rows of a tenant-scoped table runs under its own reviewed role or policy, added in its own migration, and ADR-0020's per-tenant data migration line is amended to name it. | With `FORCE ROW LEVEL SECURITY` and every policy granted to `phoenix_app` only, the migration role matches no policy: a data migration under it silently reads and changes no row. | The first data migration on a tenant-scoped table. |
| **Pre-created local accounts and the realm contract** (security review of slice 1.5, M1). (a) Slice 1.6 refuses a role grant on a local account that is not yet linked (`subject IS NULL`), or has the admin supply the Keycloak user id when creating the account. (b) Each tenant realm is checked against a written contract by a realm-export or deploy check: user registration off, `editUsernameAllowed` off, the attribute behind `KEYCLOAK_DIRECTORY_CLAIM` read-only in the user profile and fed only by LDAP federation. | A local account links to the first Keycloak subject that signs in with its username (`matchSignIn`, `domain/account.ts`), and an identity counts as a directory user when the directory claim is present. A realm that lets a user pick or rename a username, or edit that attribute, lets them take over a pre-created account and its roles, or get a directory account studio cannot disable. | (a) **Done in slice 1.6:** `AssignRole` answers `identity.account.not-linked` (test/db/identity.db-spec.ts, both fixtures). (b) The first realm provisioning script or Helm chart, and before real data. |
| **Role assignment integrity** (database review of slice 1.5). A unique key on `role_assignment` (`UNIQUE NULLS NOT DISTINCT (tenant_id, account_id, role_id, site_id)`) and "level equals the role's scope" enforced in the database by a composite foreign key to a unique `(tenant_id, id, scope)` on `role`. | Today the same grant can be stored twice and the level rule lives in code only (`held-keys.ts`). | **Done in slice 1.6** (migration `20261027190000_identity_role_grants`; both constraints tested in test/db/identity.db-spec.ts). |
| **Site grants narrowed in the use case** (security review of slice 1.5, L1). The first site-scoped permission key ships with the actor snapshot of PoC 2 verdict 8 (the actor's grants carried with the actor, so a use case can call `grantCoversSite`) and a test on both fixtures that a grant at site A does not act on site B. | `holdsEveryKey` (`identity/application/access/held-keys.ts`) admits a site-level grant for any site of the tenant; the use case must narrow it, and today no port gives a use case the actor's grants. | The first site-scoped permission key. **Slice 1.6** ships the first, `identity.role-assignments.manage`: `AssignRole` and `RevokeRoleAssignment` read the actor's grants in their own unit and narrow them with GrantPolicy's reach (a grant at site A does not act on site B, tested on both fixtures). Still open: the actor snapshot for the site keys of other modules. |
| **Session lifetime hygiene** (security review of slice 1.5, L2). An idle timeout (or an ADR recording why none), ending the session the browser presents when it signs in again, and a purge job for expired session rows (they hold `idp_session_id`), with an index on `session(tenant_id, expires_at)` for it. | Sessions have an absolute lifetime only (`STAFF_SESSION_HOURS`, 8 h by default), a new sign-in leaves the previous session live, and expired rows are never deleted. | The sign-in hardening package after slice 1.8 (portal sessions share the table now), and before real data. |
| **Directory sync resilience** (security review of the directory sync, M2 and M4). (a) One unanswered subject skips only that subject (`partial` with an `unanswered` count) instead of failing the tenant. (b) An operations alert or metric when a tenant stays `failed` or `halted` for more than a few intervals, and an audited studio "apply anyway" for a halted run. (c) A time budget per tenant, or one unit of work per tenant, so a slow directory does not delay the others, and the job stops its work when it loses its lock. (d) A run lease (`running_until`) so runs never overlap; today "sync now" has a 30 s cooldown and every change is conditional. (e) A directory change event that triggers a sync where the customer can send one (ADR-0022 implementation note for P6). | Today a single bad answer, or a persistent safety stop, stops every disable of the tenant with one audit row and a warn log; tenants run one after another under one job lock. A person who left could keep access beyond the interval the owner set (P6). | **Before real data**, and before the first production tenant relies on the directory sync. |
| **Disable reason** (security review of the directory sync, L3). Store why an account is disabled (`directory`, `local`, `emergency`) and let the sync re-enable only accounts it disabled itself. | `syncChangeOf` re-enables any disabled directory account. That is safe today, since only the sync can disable one, but a later emergency lockout of a directory account would be undone within a minute. | The first other way to disable a directory account. |
| **Admin client per realm** (security review of the directory sync, M3). Confirm that only the platform team administers the tenant realms; otherwise give each realm its own admin client secret (tenant configuration or a secret store) instead of the shared `KEYCLOAK_ADMIN_CLIENT_SECRET`. Document in the install guide that each realm's LDAP provider uses `NO_CACHE` and MSAD account controls, which the sync depends on. | One client id and secret is registered in every realm: whoever reads one realm's clients gets `view-users` on every other tenant's realm. | The Keycloak realm provisioning script or Helm chart, and before real data. |
| **Identity indexes and versioning patterns** (database review of the directory sync). A partial index `account (tenant_id, id) WHERE source = 'directory'` once portal users share `identity.account`, and a declared versioning pattern (ADR-0007) on every identity entity. | `directoryAccounts` scans every account row of the tenant; the identity models declare no pattern yet. | The sign-in hardening package after slice 1.8. Slice 1.8 put portal users in `identity.account` and bound the staff repository to `population = 'tenant-staff'`; the partial index and the patterns are still open. |
| **First tenant administrator** (owner card of slice 1.6, 2026-10-27: "both"). A command-line bootstrap that creates a new tenant's system role and its first holder, run by the platform team, refused once the tenant has a holder; later a page in the admin panel for the platform operator. | A new tenant has no account holding any role, so nobody can grant one in studio. | The command: **done** in slice 1.6, part 2 (`run-command identity.bootstrap-tenant-admin`, README; it also recovers a tenant whose holders are all disabled). Open from its security review: the audit names the system actor, not the operator who ran it (L3), so a run is tied to a person only through the log's correlation id and the runbook; record the OS user or a ticket reference when the admin panel page replaces it. The page: the admin panel and the `platform-operator` population. |
| **Role deletion and default roles** (slice 1.6). A use case to delete an unassigned custom role (the app holds no DELETE on `identity.role` yet), and the versioned seed of default roles (ADR-0004 decision 7) once the product owner names them. | Custom roles can be created and changed but not removed; no default role exists. | The studio roles screen (slice 1.10), or the first default role named in a module brief. |
| **Role grant follow-ups** (security review of slice 1.6). (a) `AssignRole` answers `site.not-found`, `account.not-found` and `account.not-linked` before the reach check, so a site-scoped actor learns whether an id exists in the tenant; answer not-found until reach passes once site admins can list accounts. (b) A site move does not re-check the grants below it (a grant made just before a move stays). (c) `GrantPolicy` rule 7 checks "holds a system role", not the system role of the protected key's scope; tighten before a site-scope system role exists. (d) The `canActOn` subtree check for a site actor acting on an account (the comment in `grant-policy.ts`). (e) Refused grants are neither logged with their reason nor audited. | Ids are UUIDv7 and every answer stays inside the tenant, so (a) leaks existence only; (b) to (d) need a use case that does not exist yet. | (a) and (d): the first site-admin account screen (slice 1.10). (b): the next tenancy slice. (c): the first site-scope system role. (e): the sign-in hardening package after slice 1.8. |
| **Disable in Keycloak too** (security review of slice 1.5, L3). Disabling a local account also disables the Keycloak user and ends its realm sessions (PoC 2 verdict 4), through the identity provider port, outside the unit; plus an "end all sessions of an account" use case for a directory account in an emergency. | `DisableStaffAccount` ends the core sessions only; the person keeps a live realm SSO session for any other client of the realm, and a directory account's core sessions live until they expire. | The sign-in hardening package after slice 1.8. The AD sync added a Keycloak admin client, but it holds realm-management `view-users` only, on purpose; disabling users needs `manage-users`, and widening that client is its own security review. |
| **Portal sign-in follow-ups** (security and QA reviews of slice 1.8). (a) Alert on the tenant-wide ratio of wrong to right answers, and consider a tenant ceiling on wrong answers or longer email codes. (b) Erasure deletes the account's `portal_contact` rows (their lookup hash stays after the subject key is destroyed; needs a DELETE grant and a reviewed path). (c) A refused RCPT answers `portal.delivery-failed`, which tells a visitor whether a mailbox exists on the tenant's own mail server: answer as sent and log only. (d) A KEK rotation must rebuild every `lookup_hash` (the blind-index key derives from the KEK). (e) `MailSender` and `SmsSender` take the `CallContext`, so a send failure logs its correlation id. (f) Code requests per address (5 an hour, each behind a CAPTCHA) can still be spent by someone else: weigh a per-address cool-down that the owner's code resets. | Guessing is bounded per code (5 answers) and per network; codes need a CAPTCHA; the lookup hash needs the KEK; the mailbox leak is about the mail server, not a portal account. | (b) with the erasure use case; (d) with the KEK rotation; the rest in the sign-in hardening package after slice 1.8. |
| **Field-level access follow-ups** (slice 2.0, ADR-0024). (a) Field ids are UUIDv7 minted by the definition module when a field is added and kept across renames (the audit catalogue takes ids only); the forms (2.4/2.5) and objects (2.8) definitions adopt this, declare `objects.record.*` and `forms.submission.*` with `qualifier: 'definition'`, and call `resolveFieldAccess` / `FieldPolicy.project` / `checkWrite` on every read and write path with a hidden-field test on both fixtures. (b) The `sensitive` flag and "removing it needs a protected key" live on the definition: the definition module declares that protected key. (c) `FieldRuleReader` runs its own read-only unit until the request's actor-snapshot unit (ADR-0020) exists; then both reads move there. (d) A system role holds every definition but no field rule, so a sensitive field stays hidden for it until a custom role with a rule opening it is granted (fail closed; four eyes, since nobody grants a role to themselves). (e) A delegate (non-system) author may open a field only where its own role holds a rule at least as wide, and must copy its own narrowings into a role that covers the same definition (`GrantPolicy`, ADR-0024 decision 10). | The mechanism is built before its consumers (ADR-0024 consequences); its contract for them is written here. | (a) and (b): done for forms in slice 2.5 (inbox and on-behalf writes); objects in slice 2.8. (c): the actor-snapshot unit. (d) and (e): revisit with the studio roles screen if staff find them strict. |
| **Studio sign-in on several hosts** (slice 1.10). The API has one `STUDIO_SIGN_IN_CALLBACK_URL`; a deployment whose studio serves several tenants on several hosts needs the callback on the host where the sign-in began (a callback URL per tenant, or a template with the host), and each host registered on its realm's client. | Keycloak sends the browser back to the one configured host: a sign-in started on another tenant's host lands on the wrong tenant and is refused (its flow cookie is on the first host). One studio host per deployment works today. | The first deployment that serves two tenants from one studio, or the Helm chart's studio values. |
| **Member language choice in the panels** (slice 1.10). The studio renders in the tenant's default locale (`GET /tenancy/presentation`); a member choosing among the tenant's `supportedLocales`, and texts for languages other than Persian and English. | Every member of a tenant sees its default language; a language without texts falls back to English. | A product-owner story, or the first tenant whose staff need two languages. |
| **Panel BFF hardening** (security review of slice 1.10 part 2: L2, L4, I2, I3). (a) `import 'server-only'` in `packages/panel-server` and each panel's `_server/`, so the Next.js build itself fails on a client path (a new dependency: its own PR); `check-panel-boundaries` sees direct imports only. (b) The BFF allow-lists the configured Keycloak origin for the sign-in redirect, not any https URL. (c) A trusted client-address header from BFF to API, before any API limit keyed on the client's IP serves a panel (the portal's form intake). (d) Exact relay prefixes per screen instead of `tenancy` (done in slice 1.10 part 4: `tenancy/sites`, `tenancy/site-domains`, `tenancy/organizations`). | The API's gate, CSRF token and Origin check stay the controls; these narrow what a mistake in panel code or a compromised API answer could reach. | (a) and (d) with the studio screens (slice 1.10 parts 3 and 4); (b) with the Keycloak deploy values; (c) done in slice 1.8: the relay forwards the browser's address when `PANEL_PROXY_HOPS` names the proxies in front of the panel, and the API trusts it from `TRUSTED_PROXIES` only. |
