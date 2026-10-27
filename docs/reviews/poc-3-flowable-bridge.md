# PoC 3 (slice 0.8): the Flowable bridge

Status: report only (owner decision D5). The code is on branch `spike/poc-3-flowable-bridge` at
`03c8fc8` (spike code in `328fe0b`) and is not merged; Phase 1 and Phase 2 copy from it.

## خلاصه برای صاحب پروژه

صاحب پروژه، این آزمایش نشان داد که پل بین هستهٔ Phoenix و موتور فرایند Flowable با معماری
ADR-0005 کار می‌کند و **معیار اصلی برقرار است: در هیچ‌یک از ۴۵ آزمون، هیچ کاری (task) گم یا تکراری
نشد**، روی هر دو مستأجر آزمایشی (demo-fa و demo-en).

- یک فرایند تأیید مرخصی کامل ساخته شد: فرم JSON Schema در هسته ثبت می‌شود، از راه outbox
  فرایند در Flowable شروع می‌شود، کار در صندوق کارهای هسته دیده می‌شود، فقط مسئولِ همان کار
  (و فقط در مستأجر خودش) می‌تواند آن را انجام دهد، و اگر مهلت بگذرد کار به مدیر ارجاع می‌شود.
- خرابی‌ها واقعاً شبیه‌سازی شدند: خاموش‌کردن ناگهانی Flowable و روشن‌کردن دوباره، کشتن فرایند
  worker درست وسط ارسال، ارسال تکراری در هر دو جهت، و گذشتن مهلت در زمان قطعی. در همهٔ موارد
  سیستم خودش را بدون دخالت دستی درست کرد.
- چهار تغییر طراحی لازم است (جزئیات در بخش Verdicts): ۱) ارسال به Flowable باید با «اجاره»
  (lease) باشد نه قفل ردیف؛ ۲) شروع تکراری فرایند باید با کلید کسب‌وکار پیدا و حذف شود؛
  ۳) خواندن وضعیت از Flowable باید به‌جای پرس‌وجوی تک‌تک درخواست‌ها، بر پایهٔ «از آخرین بار به
  بعد» باشد تا در مقیاس بالا کند نشود؛ ۴) جداسازی مستأجر در Flowable فقط منطقی است، پس هسته
  باید هر پاسخ Flowable را دوباره از نظر مستأجر بررسی کند (پیاده شد).
- **یک پرسش کسب‌وکاری برای شما:** اگر تأییدکننده پیش از پایان مهلت تصمیم بگیرد ولی به‌علت
  قطعی، تصمیمش پیش از مهلت به Flowable نرسد، الان مهلت برنده است: کار به مدیر می‌رود و تصمیم
  تأییدکننده «جایگزین‌شده» ثبت می‌شود (گم نمی‌شود). آیا قاعده باید همین باشد یا زمانِ تصمیم ملاک
  است؟ این پرسش در بازبینی فاز ۲ مطرح می‌شود.
- پایگاه دادهٔ Flowable جدا از هسته است (پایگاه و نقش جدا در همان PostgreSQL)؛ هیچ‌کدام به
  دیگری دسترسی ندارند. Docker در این محیط اجرا نشد، پس Flowable از فایل رسمی منتشرشده اجرا شد.

## 1. Setup

| Item | Used | Note |
| --- | --- | --- |
| Node.js | 24.22.1 | From the `node-linux-x64@24.22.1` tarball of the npm registry (the machine has 22). The skeleton targets 24. |
| pnpm | 10.28.0 | |
| PostgreSQL | 16.15, own cluster on port 5434 (`/home/claude/pg-poc3`) | Production targets 17; nothing here depends on 17. |
| Flowable | Flowable REST 7.1.0 (`org.flowable:flowable-app-rest:7.1.0` war, SHA-1 checked against Maven Central) on OpenJDK 21 | `dockerd` was tried once and did not start (a stale pid file of another session's daemon, no socket), so the released war ran instead of the `flowable/flowable-rest:7.1.0` image. The war ships H2 only; the PostgreSQL JDBC driver 42.7.4 (BSD-2-Clause, SHA-1 checked) was added to `WEB-INF/lib`. |
| Flowable settings | history `full`, timer and async job acquisition every 1 s (default 10 s), demo definitions off | `infra/flowable/run-flowable.sh`, controlled by `infra/flowable/flowablectl.sh start/stop/kill/status`. |
| Databases | core: a throwaway database per test run (the skeleton's DB-test harness, as `phoenix_api` under RLS); Flowable: database `flowable`, role `flowable`, schema `public` (56 `act_*` tables) | See section 6. |
| New dependency | `ajv` 8 (MIT), JSON Schema validation | Licence gate passes; in a real slice it gets its own PR (CLAUDE.md rule 12). |

`pnpm verify` is green on the branch (typecheck, lint, boundaries, licences, 470 unit and HTTP
tests, 74 database tests, migrations reversible). The PoC suite (`pnpm test:poc`) is separate
because it needs a running Flowable: 45 tests, about 3.5 minutes, run twice, green both times.

## 2. What was built

All in the `process` module, following ADR-0001's layout; the code is meant to be copied.

- `prisma/schema/process.prisma` and migration `20261027134944_process_bridge_poc` (with
  `down.sql`): `form_revision` and `process_revision` (V1, insert-only grants),
  `request` (V3: form revision, process revision, SHA-256 of the canonical submission),
  `task` (the core's Task Inbox), `outbox`, `inbox` (key `(tenant_id, event_id, handler)`),
  `incident` (V4). Every table has `tenant_id`, the reference RLS policy and CHECK constraints.
- `domain/task.ts`, `domain/request.ts`: the task and request rules (pure, unit-tested).
- `domain/events.ts`: `process.request-submitted.v1` and `process.task-completion-requested.v1`
  through `defineEvent` (ids, enums and integers only; no personal data).
- `application/ports/process-engine.ts`: the only door to Flowable. Adapter:
  `infrastructure/flowable/flowable-rest-engine.ts`.
- Use cases: `SubmitRequest`, `ListMyTasks`, `CompleteTask` (the only way a task is completed).
- Bridge: `application/bridge/command-relay.ts` (core to Flowable) and
  `application/bridge/engine-sync.ts` (Flowable to core).
- Test harness: `apps/api/test/poc/` (fault-injecting engine decorator, Flowable process control,
  a worker child process that is SIGKILLed mid-relay, the criterion check).

Not built (not needed to answer the question): Nest wiring, HTTP controllers and OpenAPI, the
worker's scheduler loop, `platform/events` and `platform/audit`, subject-key encryption of the
answers. The bridge classes are framework-free and take a `TenantContext` per pass, so the
deferred `scheduler` can drive them per hosted tenant unchanged.

## 3. The bridge as designed and tested

```
 use case (one transaction)          worker: CommandRelay.runOnce(tenant)               Flowable
 request/task row + outbox row  -->  1 claim: lease + attempts CAS (short unit)
                                     2 call : find-or-start / key-then-complete  ----->  REST
                                     3 ack  : apply outcome + published_at (short unit)

 core Task Inbox  <--  worker: EngineSync.runOnce(tenant)  <--  REST reads (runtime + history)
                       observation -> derived event id -> inbox (event_id, handler) + change,
                       one unit per observation
```

**Core to Flowable (outbox relay).** The use case writes its row and the outbox command in one
transaction. The relay never calls Flowable inside a transaction: it claims due rows with a
lease (compare-and-set on `attempts`, `lease_until = now + lease`), calls Flowable, then acks in
a second short unit. A crash anywhere leaves the row claimed until the lease runs out; then any
relay claims it again. Each command is idempotent on the Flowable side:

| Command | Idempotency key | How a repeat is recognised |
| --- | --- | --- |
| start (`request-submitted`) | the request id, as Flowable **business key** | `GET /history/historic-process-instances?businessKey=…&tenantId=…` before starting; an existing instance is adopted, never started again. The start targets the exact deployment of the core's process revision (deployment name `<key>@<revisionId>`), never "latest". |
| complete (`task-completion-requested`) | the outbox **event id**, stored as task-local variable `phoenixCompletionKey` before the complete call | A repeat finds the task gone (404) and reads its history: ended without delete reason and with our key = already done by us; ended with a delete reason = the timer won (`superseded`); our key absent = completed outside the core (incident). |

The request adopts one instance, first writer wins (`request.process_instance_id` set only
while null, by the relay's ack or by the sync, whichever comes first). Any other instance with
the same business key is an **orphan**: the core deletes it in Flowable and records an
`orphan-instance` incident. Its tasks are never surfaced.

**Flowable to core (polling, ADR-0005's "polling" option).** Each pass per tenant reads the open
tasks, the history of tasks that vanished, the history of each running request's instance, and
ended instances. Each fact becomes an observation with an event id **derived** from what it
observes (`uuid-v8(sha256(tenant, kind, engine id))`, e.g. `task-opened:<taskId>`), so the same
fact seen on any later pass, or by a second worker at the same moment, has the same id. One unit
per observation inserts `(tenant_id, event_id, handler)` into `process.inbox` with
`ON CONFLICT DO NOTHING` and applies the change only when the row is new. The unique
`(tenant_id, engine_task_id)` of `process.task` is the second guard.

Because the sync re-reads Flowable's state instead of receiving messages, nothing Flowable did
while the core was down can be missed: the next pass sees it. A task that opened and closed
between two passes (a core outage longer than a deadline) is backfilled from the instance's
history as a closed task, so the inbox history has no gap.

**Authorisation and forms.** The Task Inbox is the core's table; Flowable is never asked who may
act. `CompleteTask` lets only the assignee act, in the task's tenant; anyone else, including the
other tenant, gets `task.not-found`. A submission is validated against the published form
revision's JSON Schema (Ajv) before anything is written.

## 4. Method

- Real components: the core's Prisma persistence, tenant guard and RLS as the application login;
  Flowable REST 7.1.0 on PostgreSQL with real timers; both tenant fixtures in every scenario.
- Injected failures:
  - `FaultyEngine` (test decorator around the real adapter): `down` (every call fails as
    connection refused), `dieBefore` / `dieAfter` (the call never settles, before reaching or
    after Flowable has done its work; the relay is abandoned as a killed worker would be and its
    lease stays), `delayBefore` (a slow worker).
  - Real processes: Flowable killed with SIGKILL and started again (`flowablectl.sh`); a worker
    child process running the built API (`apps/api/dist`) SIGKILLed right after the Flowable
    call returned and before its ack.
  - Redelivery forced by resetting `published_at` (at-least-once), concurrent relays and syncs,
    a lease that runs out while a slow worker still holds the command, a direct completion in
    Flowable behind the core's back.
- The criterion, checked after convergence for every request a test touched
  (`Harness.criterion`): exactly one live Flowable instance with the request id as business key
  and it is the adopted one; every task that instance ever had (history) is in the core exactly
  once; the core's open tasks equal Flowable's open tasks.

## 5. Failure matrix and results

Every row ran for **both** tenants (F9, F11, F12, O1 and O2 cover both in one test). "Criterion"
means the check of section 4 passed. Run twice; identical outcomes.

| # | Failure | Result | Evidence |
| --- | --- | --- | --- |
| F1 | Crash after the DB commit, before the Flowable call (relay claimed, died at the engine door) | Criterion. Next relay after the lease delivered; 1 start in total, outbox `attempts = 2`. | `02-failure-matrix` F1 |
| F2 | Flowable started the instance, worker died before the ack | Criterion. The retry found the instance by business key and adopted it; `startInstance` called once in total; no orphan. | F2 |
| F3 | Flowable completed the task, worker died before the ack | Criterion, request `approved`, no incident. The sync ran first and closed the task from history by its completion key; the relay then saw it done and made no second complete call. | F3 |
| F4 | Flowable unreachable (3 relay and sync passes) then back | Criterion for both requests. Commands stayed unpublished with `last_error = engine.unreachable`, `attempts = 3`; the sync failed fast and changed nothing; after recovery 1 start and 1 complete. | F4 |
| O1 | **Flowable SIGKILLed** with a decided task pending and 2 new submissions per tenant, then restarted (ready after 11 to 13 s; 20 s on a cold first start) | Criterion for all 6 requests; 6 commands waited with `engine.unreachable`, all delivered once after restart; decided requests ended `approved`. | `03-real-outages` O1 |
| F5a | Duplicate delivery core to Flowable: 3 relays race for 5 commands | Each command claimed once, 5 starts, criterion for all. The first claim unit took all 5 rows in both runs (`[5, 0, 0]`), so this shows no double claim but did not force a lost compare-and-set; F5c and F6b are the contended cases. | F5a |
| F5b | Duplicate delivery core to Flowable: start and completion both redelivered after their ack | Criterion; **0** extra start calls, **0** extra complete calls, no incident. | F5b |
| F5c | The lease runs out while a slow worker holds the start; a second worker starts too | Flowable had **2 instances** for one request (the find-before-start check cannot stop this race). The core adopted the first, deleted the second and recorded `orphan-instance`. Criterion: 1 live instance, 1 core task. | F5c |
| F6 | Duplicate delivery Flowable to core: 3 sequential and 3 concurrent sync passes over the same state | 0 changes applied in all 6 passes, every observation counted as a duplicate (10 per pass), inbox row count unchanged. | F6 |
| F6b | Two or three syncs see the same new task at the same moment | Exactly one applied it (`[0, 1, 0]`, `[1, 0, 0]`, `[0, 0, 1]` across runs); one task row. | F6b |
| F7a | **Timer fires while the core bridge is down** (deadline 3 s, no relay or sync for 7 s) | Next pass: approver's task `escalated`, manager's task open. Criterion (2 engine tasks, 2 core tasks). | F7a |
| F7b | Core down from just after the start: the approver's task opens **and** escalates unseen | Backfilled from history as `escalated`, manager's task open. Criterion. | F7b |
| O2 | **Timer falls due while Flowable is down** (deadline 5 s, Flowable killed for 7 s) | Flowable fired the overdue timer on restart; the core saw the escalation 1.2 to 1.7 s after Flowable answered again. Criterion. | O2 |
| F7c | Approver decides in the core, Flowable unreachable, the deadline passes, Flowable back | The deadline won in Flowable. The core marked the task `superseded` (the decision is kept on the row), recorded `completion-superseded`, the manager got the task. Criterion: nothing lost or doubled, but the approver's decision did not count (section 7.2). | F7c |
| O3 | **Worker process SIGKILLed** right after Flowable started the instance | Outbox row left `attempts = 1`, unpublished; after the lease a new relay adopted the instance, **0** new starts, no orphan. Criterion. | O3 |
| O4 | **Worker process SIGKILLed** right after Flowable completed the task | The relay's retry got 404, read history, matched its key: `completed`, request `rejected` as decided, no incident. Criterion. | O4 |
| F10 | Task completed directly in Flowable (not through the core) | Core closed the task and recorded `completed-outside-core`. Criterion. | F10 |
| F9 | Cross-tenant access through the adapter | Reading a demo-en task as demo-fa: not found; completing it as demo-fa: `EngineTenantMismatchError`, the task stayed open. Core: the other tenant's user gets `task.not-found` (RLS). | F9, `01-approval-flow` |
| F11 | Unique index experiment in Flowable's DB | Without it, 2 concurrent starts with one business key both succeed (2 live instances). With `UNIQUE (tenant_id_, business_key_) WHERE business_key_ IS NOT NULL AND delete_reason_ IS NULL` on `act_hi_procinst`, one succeeds and the other fails with a 500 (relayed as `server-error`, retried, then adopted). | F11 |
| — | Happy path and escalation path | Submit, approve or reject, done; escalation after a 3 s deadline reached the core in 3.4 to 4.3 s. Criterion on both tenants. | `01-approval-flow` |
| P1 | Indicative cost (not a load test), 100 requests per tenant | Relay: 53 to 82 ms per start. First sync pass: 2.7 to 3.5 s; an idle pass with 100 running requests: 1.9 to 2.3 s, about 20 ms per running request. | `04-polling-cost` |

### Idempotency keys and inbox dedup, as observed

- Start: business key = request id. In F2, F5b and O3 the repeat found the instance and called
  `startInstance` 0 times. In F5c (true concurrency past the lease) the key alone was not enough;
  the adoption rule and orphan removal closed the gap.
- Complete: `phoenixCompletionKey` = outbox event id, stored task-local before completion and kept
  by Flowable history. In F3, F5b and O4 the repeat recognised its own completion; in F10 the
  missing key exposed a completion made outside the core.
- Inbox: `(tenant_id, event_id, handler)` with derived event ids. F6 shows 60 duplicate
  observations and 0 changes over 6 passes; F6b shows one winner among concurrent first
  observations. The task table's unique `(tenant_id, engine_task_id)` was never needed as the
  last guard in these runs, but it holds.

## 6. Flowable's database and tenant isolation

- **Placement:** Flowable has its **own database** (`flowable`) and **own login role**
  (`flowable`, no superuser, no BYPASSRLS) on the same PostgreSQL cluster; `PUBLIC` has no
  `CONNECT` on either database. Tested both ways: `phoenix_api` cannot connect to `flowable`, and
  `flowable` cannot connect to the core database (F12). Flowable creates and upgrades its own
  56 tables (`flowable.database-schema-update=true`); the core never reads them. This matches
  ADR-0005 (embedding Flowable in the core schema was rejected). A separate cluster is possible
  without code changes (only the JDBC URL).
- **Per-tenant isolation inside Flowable is logical only.** Every deployment, definition,
  instance, task, timer job and history row carries `tenant_id_` (checked on `act_ru_execution`,
  `act_ru_task`, `act_ru_timer_job`, `act_hi_procinst`, `act_hi_taskinst`). The process is
  deployed per tenant, and every instance and task we created carried the tenant. But:
  - Flowable OSS has no row-level security and no per-tenant REST credential: the one REST user
    sees every tenant.
  - Flowable REST **silently ignores query parameters it does not know**. Measured: `tenantID=`
    (wrong case) on `/runtime/tasks` returned tasks of both tenants, and
    `processInstanceBusinessKey=` (the obvious but wrong name; the right one is `businessKey`)
    returned all 822 instances instead of none (F9). A typo in an adapter filter is therefore a
    cross-tenant leak, not an empty result.
  - So the adapter passes `tenantId` on every call **and** checks the tenant (and business key or
    id) of every object that comes back; a mismatch throws `EngineTenantMismatchError` (tested).
- Silo tenants (separate database or on-prem deployment, ADR-0002) get their own Flowable with
  its own database; pooled tenants share one Flowable, isolated by `tenant_id_` plus the
  adapter's checks.

## 7. Other findings

1. **Lock versus lease.** ADR-0006 decision 4 describes the relay as `FOR UPDATE SKIP LOCKED`
   around the delivery (the in-process template holds the lock while handing events to the bus).
   That cannot be kept across an HTTP call without breaking "no HTTP inside a unit of work" and
   the 5 s unit timeout. The relay for external side effects therefore uses claim (lease),
   call, ack. The consequence, shown in F5c, is that a call can be repeated concurrently once a
   lease expires, so every external command must be idempotent and duplicates must be
   detectable.
2. **Decision versus deadline.** When a decision cannot reach Flowable before the deadline (F7c)
   the interrupting timer wins. Nothing is lost (the decision stays on the core row as
   `superseded`, the incident is recorded, the manager gets the task), but the approver acted in
   time and the system ignored it. Which rule applies is a business decision (owner question).
3. **Polling cost grows with running requests.** The per-request history read costs about 20 ms
   per running request per pass (P1); 10 000 running requests would make a pass take minutes.
4. **Packaging.** The released war has no PostgreSQL driver; on-prem builds need an image or war
   with the driver added (the PoC repacked it). Flowable needed 11 to 20 s to come back after a
   kill; overdue timers then fire within about 1 to 2 s.
5. **Escalation latency** = timer acquisition interval (set to 1 s here; Flowable's default is
   10 s) + the sync interval.

## 8. Not tested

- The `flowable/flowable-rest` Docker image (no Docker daemon); PostgreSQL 17 (16 used).
- Real identity and authorisation (Keycloak sessions, `UseCaseGate`, permissions): the actor is
  minted by the test builders; HTTP controllers, OpenAPI, Nest wiring and the worker scheduler.
- Audit log entries for task decisions; subject-key encryption of the submitted answers.
- DMN, call activities, multi-instance tasks, candidate groups (only single assignees), task
  reassignment by Flowable other than the boundary timer.
- Several Flowable nodes sharing one database (async executor across nodes); several core worker
  processes beyond the concurrent relays and syncs inside one process plus one child process.
- Load, soak, latency percentiles; anything beyond 100 requests per tenant.
- Clock skew between the core and Flowable; network partitions where Flowable succeeded but the
  response was lost after a timeout (covered in effect by "worker died after the call").
- Backup and restore of the two databases to different points in time (would surface as
  `unknown-request` or orphans; not exercised).
- Migrating running instances to a new process revision; Flowable version upgrades.
- The mandatory security review of the bridge (ADR-0005); the unique index of F11 under a
  Flowable upgrade.

## 9. Verdicts

| Risk | Verdict | Exactly what |
| --- | --- | --- |
| R1 Dual write between core and Flowable loses or duplicates a task (ADR-0005 consequence) | **Accepted**, with the design changes R2 to R5 | The criterion held in all 45 tests on both tenants, under every injected failure, including real SIGKILLs of Flowable and of the worker. |
| R2 Relay holds a row lock during the Flowable call (ADR-0006 decision 4) | **Design change** | For commands with an external side effect, the relay is claim (lease: `attempts` compare-and-set + `lease_until`), call outside any transaction, ack (`published_at`), each a short unit; lease = call timeout × 2 or more (60 s with a 5 s timeout here); failed calls release the row with `last_error` and a retry time. Amend ADR-0006 decision 4 with an "Amended by" note; the in-process event bus may keep `FOR UPDATE SKIP LOCKED`. |
| R3 Duplicate process start (lease overlap, F5c) | **Design change** | Mandatory in the `process` module: (a) business key = request id and find-before-start through history; (b) first-writer-wins adoption of `request.process_instance_id`; (c) any other instance with the key is an orphan: deleted in Flowable, `orphan-instance` incident, its tasks never surfaced. Optional on-prem hardening, decided by `cto`: the unique index of F11 on `act_hi_procinst`, created at install on an empty database and re-checked after every Flowable upgrade. |
| R4 Duplicate or lost completion | **Accepted** | Completion key = outbox event id, stored as task-local variable `phoenixCompletionKey` before the complete call; a 404 is resolved from history by that key (own completion, timer won, or completed outside the core). |
| R5 Flowable to core channel | **Design change** | Keep polling (no engine plugin, no lost messages, survives every outage tested), but replace the per-request history reads before production scale with watermark queries per tenant: open tasks (paged), `historic-task-instances?finished=true&taskCompletedAfter=<w>`, `historic-process-instances?finished=true&finishedAfter=<w>`, with the watermark stored in the core minus a skew margin; the inbox makes overlapping windows safe. Keep the per-request history backfill only for requests whose open task disappeared. A Flowable-side event listener writing to a table in Flowable's database is the next step if latency must drop below the poll interval. |
| R6 Timers and escalation across outages | **Accepted** | Core outage: picked up on the next pass (F7a), unseen tasks backfilled (F7b, the backfill is a required part of the design). Flowable outage: overdue timers fire on restart (O2). Set `flowable.process.async.executor.default-timer-job-acquire-wait-time` deliberately (default 10 s). |
| R7 Approver's decision loses against the deadline during an outage (F7c) | **Accepted for safety; owner question for the rule** | Safe: nothing lost, decision kept as `superseded`, incident raised, manager gets the task. The rule (deadline wins, or decision time wins) goes to the Phase 2 review as an owner question; "decision time wins" would need the core to send `decidedAt` and the model to use a non-interrupting timer with a guard. |
| R8 Tenant isolation inside Flowable | **Design change** | Isolation in Flowable is logical (`tenant_id_`) with one all-tenant REST credential, and REST ignores unknown parameters. Required: deploy per tenant; the adapter passes `tenantId` on every call and re-checks the tenant, id and business key of every returned object (`EngineTenantMismatchError`); Flowable REST reachable from the core's network only; silo tenants get their own Flowable and database. Add an adapter test per query that a wrong-tenant object is refused. |
| R9 Flowable database placement | **Accepted** | Separate database and separate role (same cluster or another), no cross-database privileges, Flowable owns its schema updates. Rejected alternative stays rejected: Flowable tables in the core's database or schema. |
| R10 Tasks completed in Flowable directly | **Accepted** | Detected by the missing completion key, closed in the core, `completed-outside-core` incident for operators. |
| R11 Packaging Flowable for on-prem and offline | **Design change** | Ship an image or war that already contains the PostgreSQL JDBC driver (BSD-2-Clause) and the timer settings; startup takes 11 to 20 s, so health checks must wait for `/management/engine`. |
| R12 Licences | **Accepted** | Flowable OSS Apache-2.0, PostgreSQL JDBC BSD-2-Clause, Ajv MIT. Ajv enters through its own PR. |

## 10. How to reproduce

```sh
# PostgreSQL with the bootstrap roles (scripts/db/bootstrap-dev.sql) and a `flowable` database
# owned by a `flowable` login; .env with DATABASE_URL and MIGRATION_DATABASE_URL.
export FLOWABLE_WAR=/path/flowable-app-rest-7.1.0-with-postgresql-driver.war
infra/flowable/flowablectl.sh start
POC_RESULTS_FILE=/tmp/poc3.jsonl pnpm test:poc   # builds the kernel and the API, then 45 tests
```
