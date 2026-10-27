# ADR-0020: Phase 0 Proof-of-Concept Outcomes and Review Amendments

**Status:** Accepted — 2026-10-27 (team decision: design changes from the Phase 0 PoC reports
and the QA + QC review of the first PR batch; the owner-level questions stay open in
`docs/phases/phase-1-review.md`)
**Amends:** ADR-0002 (unit of work, tenant setting, PgBouncer, FORCE RLS, key rule), ADR-0004
(directory disable), ADR-0005 (adapter tenant checks, packaging), ADR-0006 (relay lease, inbox
and delivery keys, duplicate starts), ADR-0010 (platform pieces at phase start, fail-closed
permission placeholder)
**Relates to:** ADR-0003, ADR-0013, ADR-0018; `docs/reviews/poc-1-tenant-isolation.md`,
`poc-2-hybrid-login.md`, `poc-3-flowable-bridge.md`, `poc-4-rtl-portal.md`

## Context
The four Phase 0 PoCs closed their risks as accepted or design change. Several design changes
contradict the wording of accepted ADRs, and Phase 1 code (slices 1.1 to 1.3) already follows
them. The QA + QC review of the first batch asked that none of these drift silently. This ADR
records the team-level changes in one place. Business rules and owner choices are not decided
here: the per-request overhead criterion, the directory sync interval, the Persian webfont, the
ADR-0009 licence variants and the PoC 3 deadline rule stay open owner questions.

## Decision
1. **ADR-0002, unit of work and tenant setting (PoC 1 R2, R3, R7).**
   - Every unit of work is a transaction, reads included (RLS needs the transaction-local
     setting). This deviates from Mondapac's ADR-0025, which runs reads outside one.
   - The tenant is set only with `set_config('app.tenant_id', $1, true)` inside the unit's
     transaction. A session-level setting (`set_config(..., false)`, `SET app.…`) is forbidden
     outside the platform and is refused by a lint or boundary check.
   - The target is one driver-level statement right after `BEGIN` that sets the tenant (and
     read-only for read units) (`withTenantSession`; PoC 1 measured about a third less overhead).
     Fewer units per request (one read-only "actor snapshot" unit, PoC 2 #8) is the other lever.
2. **ADR-0002, PgBouncer (PoC 1 R2).** PgBouncer is allowed only in transaction mode and only
   with the rule in decision 1. Session mode and statement mode are not supported.
3. **ADR-0002, FORCE ROW LEVEL SECURITY.** Every tenant-scoped table has RLS enabled **and
   forced**, so the table owner (the migration role) is also subject to the policy. Data
   migrations on tenant tables run per tenant with the tenant set as in decision 1.
4. **ADR-0002 decision 3, key rule.** `tenant_id` leads every primary key, unique key and index
   of a tenant-scoped table. One exception: a single-column UUIDv7 `@id` (globally unique by
   construction) may stand alone; every other key and index on that table still leads with
   `tenant_id`. `check-prisma-boundaries` enforces "leads", covers `@@index`, and names the
   exception.
5. **ADR-0004 decision 3, directory disable (PoC 2 #5).** "Proven in PoC 2" was wrong for the
   directory: Keycloak sends no back-channel message when a federated user is disabled in
   LDAP/AD. A local-account disable and a role revoke take effect on the next request; a
   directory disable takes effect on the next request **after the sync**. The sync is a
   scheduled `system` job per tenant, plus a manual "sync now" in studio. Its interval is an
   open owner question.
6. **ADR-0005, Flowable adapter (PoC 3 R8, R11).** The adapter passes the tenant on every call
   and re-checks the tenant, id and business key of every object Flowable returns; a mismatch is
   refused (`EngineTenantMismatchError`), with one adapter test per query. Definitions are
   deployed per tenant. On-prem and offline builds ship a Flowable image or war that already
   contains the PostgreSQL JDBC driver (BSD-2-Clause) and the timer settings; health checks wait
   for `/management/engine`.
7. **ADR-0006 decision 4, relay lease (PoC 3 R2).** For a delivery with an external side effect
   (Flowable, mail, any HTTP call), the relay holds a **lease**, not a row lock, across the call:
   claim (compare-and-set on `attempts` plus `lease_until`) in a short unit, call outside any
   transaction, then ack (`published_at`) in another short unit. The lease is at least twice the
   call timeout. A failed call releases the row with `last_error` and a retry time. The
   in-process event bus may keep `FOR UPDATE SKIP LOCKED`.
8. **ADR-0006 decision 5, keys.** Inbox and delivery keys lead with the tenant:
   `(tenant_id, event_id, handler)` (ADR-0002 decision 3). This also applies to
   `process.inbox` (ADR-0005 decision 3).
9. **ADR-0006, duplicate external start (PoC 3 R3).** A duplicate start in an external engine
   (for example two process instances for one request after a lease overlap) is resolved by
   keeping the first: the business key is the core's id, the adapter finds before it starts, the
   first instance recorded in the core wins, and any other instance with that key is an orphan,
   cancelled in the engine and recorded as an `orphan-instance` incident. Its tasks never surface.
10. **ADR-0010 decision 1, platform pieces at phase start.** A platform piece may land at the
    start of a phase, ahead of its first business consumer, when the phase review lists it with
    its consumer and trigger. It is proven by tests (a test-only probe schema is allowed, with a
    removal trigger in `docs/platform-deferred.md`). Phase 1 uses this for authz, events,
    scheduler, worker and audit (slices 1.1 to 1.3).
11. **ADR-0010 decisions 2 and 6, fail-closed permission placeholder.** A permission or
    ownership check may be bound to a `@FailClosedPlaceholder` that always refuses: refusing is
    not a stub. A check that answers "yes", "all" or reads configuration is still forbidden.
    Platform placeholders live under `platform/<piece>/placeholders/`; module placeholders stay
    under `infrastructure/placeholders/`.

## Consequences
- `CLAUDE.md` changes in the same PR (rule 7): persistence, identity, events and deferral lines.
- Phase 1 code catches up where it does not yet comply: FORCE RLS on existing tenant tables in a
  new migration (merged migrations are never edited); the "leads" check in
  `check-prisma-boundaries`; the `set_config(..., false)` ban; the lease relay for external
  deliveries when the first one lands.
- The tenancy slice (1.4) serialises site moves per tenant and tests concurrent moves (PoC 1
  risk 8). The identity slice (1.5) builds the directory sync job (decision 5).
- PoC 1 overhead numbers are repeated on PostgreSQL 17 when the adapter-level tenant setting
  lands.

## Alternatives considered
- Leave the ADRs as written and record deviations only in `docs/platform-deferred.md`: rejected;
  the README allows a change only through a new ADR or an "Amended by" note.
- One amending ADR per PoC: rejected; four small ADRs for one review would be harder to follow.
- Drop RLS to meet the 15% criterion: rejected; the policies cost within noise, the per-unit
  transaction is the cost (PoC 1 R3).
