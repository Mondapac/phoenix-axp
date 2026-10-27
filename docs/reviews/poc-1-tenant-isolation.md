# PoC 1 (slice 0.6): tenant isolation, guard + RLS, PgBouncer, site subtree

Status: Phase 0 spike, report only (D5). Branch `spike/poc-1-2-tenancy-identity` at `73ecee4`
(spike code in `8aafd6b`); the code is not for merge, Phase 1 copies from it. Rules under test:
ADR-0002 (tenant as a first-class dimension, guard + row-level security), ADR-0018 (site tree,
subtree grants), ADR-0009 (licences).

## خلاصه برای صاحب پروژه

- **نشت داده بین مستأجرها: صفر.** با ۱۰۰۰ مستأجر، در همه‌ی حالت‌ها (مستأجر غلط یا خالی، SQL خام با
  نقش برنامه، درخواست‌های هم‌زمان روی یک pool مشترک، و PgBouncer در حالت transaction) هیچ ردیفی از
  مستأجر دیگر دیده یا نوشته نشد. نتیجه: **پذیرفته**.
- **PgBouncer (حالت transaction) سازگار است** به یک شرط: مقدار مستأجر حتماً باید «محلیِ تراکنش»
  تنظیم شود. آزمون کنترل منفی نشان داد که تنظیم در سطح session بین کاربران نشت می‌کند.
- **هزینه‌ی کارایی:** خودِ سیاست‌های RLS تقریباً رایگان‌اند (حدود ±۱۰٪، در حد نویز). اما چون هر
  unit یک تراکنش با چند دستور اضافه است، برای خواندن‌های کوچک (زیر ۱ میلی‌ثانیه) هزینه نسبت به
  «فقط guard» حدود ۱٫۵ تا ۲ میلی‌ثانیه اضافه یعنی ۱۶۰ تا ۲۵۰٪ است؛ معیار «کمتر از ۱۵٪» برای unitهای
  کوچک **برآورده نمی‌شود**. نتیجه: **تغییر طراحی** (تنظیم مستأجر در لایه‌ی adapter که هزینه را حدود
  ۳۰٪ کم می‌کند، و تعداد کمتر unit در هر درخواست). RLS حفظ می‌شود.
- **درخت سایت (۵۰۰ سایت، closure table):** دسترسی فقط رو به پایین جاری می‌شود؛ ۵۰۰٬۰۰۰ تصمیم بررسی
  شد و صفر خطا داشت (پذیرفته). بررسی دسترسی حدود ۳ میلی‌ثانیه است. اما صفحه‌ی محتوای کل درخت از
  ریشه حدود ۵۰ میلی‌ثانیه طول می‌کشد؛ برای آن **تغییر طراحی** در کوئری/ایندکس لازم است.
- **جابه‌جایی هم‌زمان سایت‌ها در یک درخت** در این PoC آزموده نشد (جابه‌جایی تکی آزموده شد و درست
  بود). نتیجه: **تغییر طراحی**: در فاز ۱ جابه‌جایی سایت‌ها در هر مستأجر یکی‌یکی (پشت سر هم) انجام
  می‌شود، و برش 1.4 (ماژول tenancy) باید آزمونی برای جابه‌جایی هم‌زمان داشته باشد.

## Setup

| Part | What ran |
| --- | --- |
| Machine | 4 vCPU container, shared: other agents' builds and tests ran at the same time (load average about 4.6). Every number below is from that machine, not a quiet one |
| Node | 24.22.1, pnpm 10.28.0, Prisma 7 with `@prisma/adapter-pg` |
| PostgreSQL | 16.15 (Ubuntu package), own cluster on 127.0.0.1:5433. ADR-0002 targets 17: not available as a package here; see "Not tested" |
| PgBouncer | 1.22, transaction mode, `default_pool_size = 8`, `max_prepared_statements = 200`, on 127.0.0.1:6433 (`spike/poc-1/pgbouncer/`). ISC licence |
| Roles | `phoenix_migrator` owns the tables (RLS not FORCEd: the owner is the migration role only); `phoenix_app` group with DML grants; `phoenix_api` login in it, no BYPASSRLS |
| Policy | per table `USING (tenant_id = platform.current_tenant_id()) WITH CHECK (same)`; the function reads `current_setting('app.tenant_id', true)` |
| Unit | every unit of work is a transaction: `BEGIN`, `set_config('app.tenant_id', $1, true)` (plus `SET TRANSACTION READ ONLY` for reads), the work, `COMMIT`. This is a deviation from Mondapac (ADR-0025 there: reads outside a transaction) that RLS forces |
| Guard | Prisma `$allOperations` extension: every model call must carry `where.tenantId` / `data.tenantId` equal to the unit's tenant; raw SQL refused except the session statements |
| Data | `spike/poc-1/seed.sql`: 1000 tenants `t0001`..`t1000` with 2..9 sites each, 200 content items and 300 form submissions each, 3 roles and 20 grants each; tenant `ministry` with 500 sites (depth up to 8), 120 items per site, 200 principals with grants. Totals: 7000 sites, 13 797 closure rows, 260 000 items, 300 000 submissions, 3002 roles, 20 600 grants, 1001 tenants |
| Copy | `phoenix_poc_norls`: the same database with RLS disabled, for the baseline variants |

Reproduce: `PGSOCKET=/home/claude/pg-poc12 spike/poc-1/setup-db.sh`, start PgBouncer with
`spike/poc-1/pgbouncer/pgbouncer.ini`, then in `apps/api`:
`node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.spike.config.cjs poc1`.
Results: `spike/poc-1/results/{isolation,pgbouncer,site-tree,overhead}.json`.

## Method and raw numbers

### 1. Guard refusals (`poc1-isolation`)

Seven models (site, siteAncestry, contentItem, formSubmission, role, roleGrant, staffAccount) ×
14 shapes: no `where`, another tenant, `tenantId in [own, other]`, `not own`, `OR` with another
tenant and no top-level tenant, count/aggregate/groupBy, create and createMany with another
tenant, updateMany/deleteMany of another tenant, updateMany that moves rows to another tenant,
deleteMany with no `where`. **98 of 98 refused** before reaching the database
(`where-missing`, `where-tenant-mismatch`, `where-tenant-missing`, `data-tenant-mismatch`,
`data-changes-tenant`).

### 2. Raw SQL as the application role (RLS alone, guard bypassed)

| Check | Result |
| --- | --- |
| `SELECT count(*)` with no tenant set, 9 tenant tables | 0 rows each |
| `INSERT` with no tenant set | refused 42501 |
| `UPDATE` / `DELETE` of another tenant's rows | 0 rows affected |
| `INSERT` a row of another tenant | 42501 |
| `UPDATE` a row to another tenant | 42501 |
| `COPY (SELECT ...) TO STDOUT` without tenant | 0 rows |
| Disable RLS, drop policy, `row_security = off`, `SET ROLE phoenix_migrator`, `TRUNCATE`, `CREATE FUNCTION`, `ALTER ROLE ... BYPASSRLS` | 42501 each |
| `pg_stats` rows visible | 0 |
| Catalog check: every tenant table has RLS enabled and a policy | 9 of 9 |
| Pooled connection after commit, error, throw, timeout: `app.tenant_id` left behind | empty in all 5 cases |
| Residual: `EXPLAIN` row estimates | show whole-table estimates (other tenants' volume), not rows |

### 3. Concurrency on one shared pool

Each unit picks one of 1000 tenants at random and either reads (counts that must equal the
owner's per-tenant counts; every row's `tenantId` must be the unit's) or writes a submission
that is afterwards found under the right tenant.

| Path | Units | In flight | Pool | Checks | Leaks | Writes / misplaced | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Production (guard + RLS), direct | 20 000 | 64 | 10 | 45 000 | **0** | 5000 / 0 | 48.6 |
| Adapter-session candidate, direct | 20 000 | 64 | 10 | 45 000 | **0** | 5000 / 0 | 37.8 |
| Raw SQL, RLS only, direct | 20 000 | 64 | 10 | 80 000 | **0** | - | 9.4 |
| Production via PgBouncer | 20 000 | 64 | 20 client / 8 server | 45 000 | **0** | 5000 / 0 | 51.8 |
| Raw SQL, RLS only, via PgBouncer | 20 000 | 64 | 64 client / 8 server | 80 000 | **0** | - | 13.2 |

The adapter candidate also refuses a write in a read-only unit (25006).

### 4. PgBouncer transaction mode (`poc1-pgbouncer`)

| Check | Result |
| --- | --- |
| 40 client connections served by | 1 server backend |
| Negative control: session-level `set_config(..., false)` by one client, read by others | **200 rows leaked** (the detector works) |
| Transaction-local `set_config(..., true)` seen by another client | 0 |
| Prisma 7 adapter-pg through PgBouncer | works (unnamed statements) |

### 5. Site subtree (`poc1-site-tree`, ministry tenant)

| Check | Result |
| --- | --- |
| Shape | 500 sites, max depth 8, 1797 closure rows; closure vs recursive walk: 0 differences |
| Exhaustive: every (grant site, target site, includeDescendants) | 500 000 decisions, **0 mismatches** against a reference walk; down allowed 1297, down denied for this-site-only 1297, up denied 2594, sideways denied 493 812 |
| Named cases | province+descendants -> county: allowed; root+descendants -> depth-8 leaf: allowed; county -> province, root, sibling, other province: denied; province this-site -> county: denied |
| Cross-tenant | ancestors of another tenant's site seen: 0 both ways; tenant-wide and root grants never cover another tenant's site |
| Move province-1 under deputy-1 | 15 ms (back 9 ms); access recomputed; moving a site under its own descendant refused; exhaustive check after the move 0 mismatches |

### 6. Overhead (`poc1-overhead`)

Each sample is one whole unit of work as a use case pays it. 10 rounds × 100 samples per
variant per operation, 100 warm-up, variants interleaved with rotating order. Variants:

- **guard-only**: Mondapac's baseline: guard, read units outside a transaction, no tenant setting,
  RLS-off copy.
- **guard+tx (policies off)**: the production unit (transaction + `set_config`) on the RLS-off copy.
  Isolates the cost of the policies themselves.
- **guard+RLS**: production.
- **guard+RLS, tenant in adapter**: the candidate: one statement right after `BEGIN` sets tenant
  and read-only at driver level (`withTenantSession`).
- **... via PgBouncer**: guard-only and guard+RLS again through PgBouncer.

Sequential p50 / p95 in ms (n = 1000 each):

| Operation | guard-only | guard+tx (policies off) | guard+RLS | tenant in adapter | guard-only via PgB | guard+RLS via PgB |
| --- | --- | --- | --- | --- | --- | --- |
| read: item by id | 0.86 / 1.37 | 2.66 / 4.43 | 2.92 / 4.67 | 2.10 / 3.28 | 1.10 / 1.89 | 3.70 / 5.45 |
| read: latest 20 of a site | 1.19 / 2.03 | 3.02 / 5.81 | 3.13 / 5.51 | 2.23 / 4.01 | 1.18 / 2.20 | 3.79 / 6.05 |
| read: count published | 0.95 / 1.56 | 2.84 / 4.19 | 2.59 / 4.05 | 1.71 / 2.64 | 1.07 / 1.56 | 3.33 / 5.60 |
| write: insert submission | 2.62 / 5.33 | 3.08 / 5.75 | 3.29 / 6.73 | 2.82 / 5.65 | 3.22 / 6.46 | 4.14 / 8.35 |
| write: update item | 2.11 / 4.51 | 2.99 / 6.00 | 2.96 / 6.34 | 2.36 / 4.81 | 2.72 / 5.35 | 3.67 / 7.73 |
| ministry: subtree access check | 0.89 / 1.53 | 2.88 / 4.25 | 3.11 / 5.17 | 2.37 / 4.19 | 1.10 / 2.17 | 4.26 / 6.67 |
| ministry: subtree page, root (500 sites) | 48.4 / 70.8 | 50.1 / 73.2 | 49.9 / 71.5 | 48.8 / 68.9 | 48.3 / 68.8 | 51.8 / 72.6 |
| ministry: subtree page, province (17 sites) | 11.9 / 16.9 | 13.9 / 19.2 | 14.6 / 20.0 | 13.1 / 18.3 | 11.1 / 15.9 | 14.5 / 21.9 |
| ministry: subtree page, leaf (1 site) | 1.55 / 2.57 | 3.28 / 4.99 | 3.42 / 5.18 | 2.71 / 4.66 | 2.01 / 3.36 | 4.71 / 7.01 |

Overhead in % (p50 / p95):

| Operation | guard+RLS vs guard-only | policies only (guard+RLS vs guard+tx) | adapter vs guard-only | via PgBouncer |
| --- | --- | --- | --- | --- |
| read: item by id | +241 / +242 | +10 / +6 | +145 / +140 | +236 / +188 |
| read: latest 20 of a site | +163 / +171 | +4 / -5 | +88 / +97 | +220 / +175 |
| read: count published | +172 / +160 | -9 / -4 | +80 / +70 | +211 / +258 |
| write: insert submission | +26 / +26 | +7 / +17 | +7 / +6 | +29 / +29 |
| write: update item | +40 / +41 | -1 / +6 | +12 / +7 | +35 / +44 |
| subtree access check | +247 / +238 | +8 / +22 | +165 / +174 | +287 / +208 |
| subtree page, root | +3 / +1 | -0 / -2 | +1 / -3 | +7 / +5 |
| subtree page, province | +23 / +18 | +5 / +4 | +10 / +8 | +30 / +37 |
| subtree page, leaf | +121 / +102 | +4 / +4 | +75 / +81 | +134 / +109 |

Concurrent mix (reads, writes, access check and province page; not the root or leaf page; 32 in flight, pool of 10, 3 runs × 3000 units):

| Variant | units/s (3 runs) | p50 ms | p95 ms |
| --- | --- | --- | --- |
| guard-only | 933, 743, 934 | 29-36 | 66-89 |
| guard+tx (policies off) | 470, 497, 484 | 61-64 | 91-97 |
| guard+RLS | 466, 487, 454 | 62-67 | 91-105 |
| guard+RLS, tenant in adapter | 587, 697, 651 | 44-51 | 65-84 |
| guard-only via PgBouncer | 799, 781, 853 | 32-35 | 74-80 |
| guard+RLS via PgBouncer | 440, 364, 427 | 70-85 | 102-126 |

Plans (`EXPLAIN ANALYZE` as the app role): with `tenant_id = const` in the query the planner
folds the policy into a one-time filter (`One-Time Filter: current_setting(...) = 't0500'`) on
top of the same index scan: the policy costs one comparison per statement. The root subtree page
is a nested loop over 500 closure rows × 120 items (60 000 rows) followed by a top-N sort:
76.7 ms execution in the `EXPLAIN` run, the same with and without RLS.

**Reading the numbers.** The policies themselves are within noise (-9% to +10% p50). The whole
difference between guard-only and guard+RLS is the per-unit transaction: `BEGIN`,
`SET TRANSACTION READ ONLY`, `set_config`, `COMMIT`, each a round trip of about 0.4-0.6 ms through
Prisma's interactive transaction. For sub-millisecond reads that is +160% to +250%; for writes
(already in a transaction) +26% to +40%; for heavy queries it disappears (+3% on the root page).
Setting tenant and read-only in one statement at the adapter removes about a third of it. The
concurrent throughput tells the same story: guard+tx without policies (484 units/s) equals
guard+RLS (469).

## What was not tested

- PostgreSQL 17 (ran on 16.15). The policy and planner behaviour shown is long-standing, but the
  numbers need repeating on 17.
- A quiet machine: other workloads shared the 4 vCPU. Relative numbers are interleaved and
  consistent across runs; absolute numbers are not production figures. No network between
  application and database (loopback): with a real network round trip the per-unit statements
  cost more, which strengthens the design change below.
- Docker images (the pull from quay.io was refused by the egress proxy); everything ran from
  distribution packages.
- End-to-end request cost with the HTTP stack (PoC 2 measured one use case; see its report).
- Concurrent moves of sites in one tree (the move algorithm itself was tested one at a time).
  Closed as a design change (verdict 8): Phase 1 serialises moves per tenant and slice 1.4 tests it.
- Batching `BEGIN; set_config(...)` into one simple-query round trip (needs a driver change; not
  tried).
- Content shared between sites (ADR-0018 sharing), site deletion, tenants with tens of thousands
  of sites, partitioning, `FORCE ROW LEVEL SECURITY` for the owner.
- PgBouncer prepared-statement mode with named statements (Prisma 7 adapter-pg uses unnamed
  ones), PgBouncer 1.23+.

## Verdicts

| # | Risk | Verdict | Detail |
| --- | --- | --- | --- |
| 1 | A query reads or writes another tenant's rows (wrong or missing tenant, raw SQL, concurrent units on a shared pool) | **accepted** | Guard refused 98/98 shapes; RLS alone held for every raw statement and privilege escape; 0 leaks in 60 000 concurrent units (190 000 checks) across 1000 tenants. Keep both layers. |
| 2 | PgBouncer transaction mode breaks the tenant setting | **accepted**, with a rule | Works with Prisma 7 adapter-pg. Rule for Phase 1: the tenant may only be set with `set_config(..., true)` inside the unit's transaction; a session-level setting leaked 200 rows in the negative control. Add a lint/guard check that refuses `set_config(..., false)` and `SET app.` outside the platform. |
| 3 | RLS + guard costs more than 15% over guard alone (p50/p95) | **design change** | The criterion fails as measured per unit (+160% to +250% on sub-ms reads, +26% to +40% on writes), but the policies are not the cause (within ±10%); the per-unit transaction is. Changes: (a) set tenant and read-only in one statement right after `BEGIN` at the adapter (`withTenantSession`, measured: about a third less, +80% to +165% on tiny reads, +7% to +12% on writes, throughput 645 vs 469 units/s); (b) fewer units per request: one read-only unit for what a request reads (PoC 2's "actor snapshot"); (c) restate the criterion per request end to end, not per tiny unit. Keep RLS. |
| 4 | Subtree grants leak upward or sideways | **accepted** | Closure-table rule (grant at the target, or at an ancestor with `includeDescendants`): 0 mismatches in 500 000 decisions before and after a move; cross-tenant lookups empty. Access check about 3 ms p50 as a whole unit (0.9 ms without the transaction). |
| 5 | Subtree content queries are too slow for large trees | **design change** for root-scale pages | Province page 14.6 ms p50, leaf 3.4 ms: fine. Root page of 500 sites / 60 000 items: 49.9 ms p50, 71.5 ms p95, with or without RLS: the plan reads every item of the subtree before the top-N sort. Change: for a "latest N in a subtree" page, query by an index on `(tenant_id, created_at DESC)` with a semi-join on the subtree (stops after N rows when the subtree is most of the tenant), or denormalise the owner site's ancestor ids onto the item (array + GIN) - to be measured in Phase 1 before choosing. Keyset pagination, not offset. |
| 6 | Statistics leak other tenants' data | **accepted** (residual) | `pg_stats` shows 0 rows to the app role. `EXPLAIN` estimates reveal table-wide row counts (volume, not content); the guard refuses raw SQL from modules, so only platform code could run it. |
| 7 | A pooled connection keeps the last tenant | **accepted** | Empty after commit, error, throw and timeout (transaction-local setting). |
| 8 | Site moves under concurrency | **design change** | Not exercised here: the move algorithm was tested one move at a time only. Phase 1 serialises site moves per tenant (a per-tenant advisory lock taken in the move's unit of work, or the move run serialisable), so two moves in one tree never interleave. Acceptance criterion for slice 1.4 (tenancy): a test that runs concurrent moves in one tenant's tree (including two moves that would form a cycle together) and then finds the closure table equal to a recursive walk and no cycle, on both tenant fixtures. |
