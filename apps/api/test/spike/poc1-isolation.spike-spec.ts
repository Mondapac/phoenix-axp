// SPIKE (PoC 1, slice 0.6): zero leaks across 1000 tenants, through the tenant guard and
// row-level security, on every read and write path. Needs spike/poc-1/setup-db.sh.
import { err, ok } from '@phoenix/shared-kernel';
import type { Client } from 'pg';
import {
  TenantGuardError,
  NoUnitOfWorkError,
  TenantMismatchError,
} from '../../src/platform/unit-of-work/errors';
import { pendingSession } from '../../src/platform/persistence/tenant-session-adapter';
import { productionPathRun, rawRlsRun } from './poc1-concurrency';
import {
  APP_URL,
  OWNER_URL,
  SCOPED_TABLES,
  connect,
  createSpikePersistence,
  ownerCounts,
  seedId,
  tenantOf,
  writeResult,
  type SpikePersistence,
} from './poc1-support';

const RLS_VIOLATION = '42501';
const A = 't0001';
const B = 't0002';
const tenantA = tenantOf(A);
const results: Record<string, unknown> = {};

async function sqlState(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    // Prisma wraps a raw-query failure as P2010; the SQLSTATE is in the message.
    if (code === 'P2010' && /read-only transaction/.test(message ?? '')) return '25006';
    return code ?? 'no-code';
  }
}

describe('PoC 1: tenant isolation across 1000 tenants', () => {
  let persistence: SpikePersistence;
  let app: Client;
  let owner: Client;
  let contentCounts: Map<string, number>;

  beforeAll(async () => {
    persistence = createSpikePersistence(APP_URL);
    app = await connect(APP_URL);
    owner = await connect(OWNER_URL);
    contentCounts = await ownerCounts('content.content_item');
  });

  afterAll(async () => {
    writeResult('isolation', results);
    await app.end();
    await owner.end();
    await persistence.close();
  });

  describe('layer 1, the tenant guard: every model, every operation shape', () => {
    // [model, a valid create row for tenant A]
    const models = {
      site: () => ({
        id: crypto.randomUUID(),
        tenantId: A,
        parentSiteId: null,
        slug: `x-${Date.now()}`,
        name: 'x',
        depth: 0,
        createdAt: new Date(),
      }),
      contentItem: () => ({
        id: crypto.randomUUID(),
        tenantId: A,
        ownerSiteId: seedId(`${A}/site/0`),
        title: 'x',
        body: 'x',
        status: 'draft',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      formSubmission: () => ({
        id: crypto.randomUUID(),
        tenantId: A,
        siteId: seedId(`${A}/site/0`),
        formKey: 'x',
        payload: {},
        submittedAt: new Date(),
      }),
      role: () => ({
        id: crypto.randomUUID(),
        tenantId: A,
        key: `r-${Date.now()}`,
        permissions: [],
      }),
      roleGrant: () => ({
        id: crypto.randomUUID(),
        tenantId: A,
        principalId: crypto.randomUUID(),
        roleId: seedId(`${A}/role/viewer`),
        siteId: null,
        includeDescendants: false,
        createdAt: new Date(),
      }),
      staffAccount: () => ({
        id: crypto.randomUUID(),
        tenantId: A,
        subject: 's',
        username: 'u',
        source: 'local',
        status: 'active',
        version: 1,
        createdAt: new Date(),
      }),
      siteAncestry: () => ({
        tenantId: A,
        ancestorId: seedId(`${A}/site/0`),
        descendantId: seedId(`${A}/site/0`),
        depth: 0,
      }),
    } as const;
    type Delegate = Record<string, (args: unknown) => Promise<unknown>>;
    const refusals: Record<string, Record<string, string>> = {};

    const attempts: Record<
      string,
      (d: Delegate, row: Record<string, unknown>) => Promise<unknown>
    > = {
      'findMany, no where': (d) => d.findMany!({}),
      'findMany, other tenant': (d) => d.findMany!({ where: { tenantId: B } }),
      'findMany, tenant in [own, other]': (d) =>
        d.findMany!({ where: { tenantId: { in: [A, B] } } }),
      'findMany, tenant not own': (d) => d.findMany!({ where: { tenantId: { not: A } } }),
      'findFirst, OR with other tenant, no top-level tenant': (d) =>
        d.findFirst!({ where: { OR: [{ tenantId: A }, { tenantId: B }] } }),
      'count, other tenant': (d) => d.count!({ where: { tenantId: B } }),
      'aggregate, no where': (d) => d.aggregate!({ _count: true }),
      'groupBy, no where': (d) => d.groupBy!({ by: ['tenantId'] }),
      'create, other tenant': (d, row) => d.create!({ data: { ...row, tenantId: B } }),
      'createMany, one row of other tenant': (d, row) =>
        d.createMany!({ data: [row, { ...row, tenantId: B }] }),
      'updateMany, other tenant': (d) => d.updateMany!({ where: { tenantId: B }, data: {} }),
      'updateMany, moves rows to other tenant': (d) =>
        d.updateMany!({ where: { tenantId: A }, data: { tenantId: B } }),
      'deleteMany, other tenant': (d) => d.deleteMany!({ where: { tenantId: B } }),
      'deleteMany, no where': (d) => d.deleteMany!({}),
    };

    for (const [model, row] of Object.entries(models)) {
      it(`${model}: refuses every cross-tenant or unscoped shape`, async () => {
        refusals[model] = {};
        for (const [name, attempt] of Object.entries(attempts)) {
          const outcome = await persistence.unitOfWork.run(tenantA, async () => {
            const delegate = persistence.service.tx(tenantA)[
              model as 'site'
            ] as unknown as Delegate;
            try {
              await attempt(delegate, row());
              return ok('ran');
            } catch (error) {
              return err(
                error instanceof TenantGuardError ? `refused:${error.reason}` : String(error),
              );
            }
          });
          expect(outcome.ok).toBe(false);
          const reason = outcome.ok ? 'ran' : String(outcome.error);
          refusals[model][name] = reason;
          expect(reason).toMatch(/^refused:/);
        }
      });
    }

    it('hands out no raw SQL, no $transaction and no other tenant', async () => {
      await persistence.unitOfWork.run(tenantA, () => {
        const view = persistence.service.tx(tenantA) as unknown as Record<string, unknown>;
        expect(view.$queryRaw).toBeUndefined();
        expect(view.$executeRawUnsafe).toBeUndefined();
        expect(view.$transaction).toBeUndefined();
        expect(() => persistence.service.tx(tenantOf(B))).toThrow(TenantMismatchError);
        return Promise.resolve(ok(undefined));
      });
      expect(() => persistence.service.tx(tenantA)).toThrow(NoUnitOfWorkError);
      results.guardRefusals = refusals;
    });

    it('lets the own tenant through with the exact counts', async () => {
      const result = await persistence.unitOfWork.run(
        tenantA,
        async () =>
          ok(await persistence.service.tx(tenantA).contentItem.count({ where: { tenantId: A } })),
        { readOnly: true },
      );
      expect(result).toEqual(ok(contentCounts.get(A)));
    });
  });

  describe('layer 2, row-level security alone (the guard bypassed): raw SQL as the app login', () => {
    const states: Record<string, unknown> = {};
    afterAll(() => {
      results.rawSqlAsAppRole = states;
    });

    async function inTx<T>(tenant: string | null, work: () => Promise<T>): Promise<T> {
      await app.query('BEGIN');
      try {
        if (tenant !== null) {
          await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
        }
        return await work();
      } finally {
        await app.query('ROLLBACK');
      }
    }

    it('without a tenant, every scoped table is empty and every write is refused', async () => {
      const seen: Record<string, number> = {};
      await inTx(null, async () => {
        for (const table of SCOPED_TABLES) {
          const { rows } = await app.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
          seen[table] = Number(rows[0]!.n);
        }
      });
      states.noTenantCounts = seen;
      expect(Object.values(seen).every((n) => n === 0)).toBe(true);
      const insert = await sqlState(
        inTx(null, () =>
          app.query(
            `INSERT INTO forms.form_submission (id, tenant_id, site_id, form_key, payload, submitted_at)
             VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'x', '{}', now())`,
            [A],
          ),
        ),
      );
      states.noTenantInsert = insert;
      expect(insert).toBe(RLS_VIOLATION);
    });

    it('with tenant A set, sees only A and cannot read, change or create B rows', async () => {
      await inTx(A, async () => {
        for (const table of SCOPED_TABLES) {
          const { rows } = await app.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM ${table}`,
          );
          expect(rows.every((row) => row.tenant_id === A)).toBe(true);
        }
        const { rows } = await app.query<{ n: string }>(
          'SELECT count(*) AS n FROM content.content_item WHERE tenant_id = $1',
          [B],
        );
        expect(Number(rows[0]!.n)).toBe(0);
        const updated = await app.query(
          "UPDATE content.content_item SET title = 'pwned' WHERE tenant_id = $1",
          [B],
        );
        const deleted = await app.query('DELETE FROM forms.form_submission WHERE tenant_id = $1', [
          B,
        ]);
        states.crossTenantUpdateRows = updated.rowCount;
        states.crossTenantDeleteRows = deleted.rowCount;
        expect(updated.rowCount).toBe(0);
        expect(deleted.rowCount).toBe(0);
      });
      const insertOther = await sqlState(
        inTx(A, () =>
          app.query(
            `INSERT INTO forms.form_submission (id, tenant_id, site_id, form_key, payload, submitted_at)
             VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'x', '{}', now())`,
            [B],
          ),
        ),
      );
      const moveToOther = await sqlState(
        inTx(A, () =>
          app.query('UPDATE content.content_item SET tenant_id = $1 WHERE id = $2', [
            B,
            seedId(`${A}/item/1`),
          ]),
        ),
      );
      states.insertOtherTenant = insertOther;
      states.moveRowToOtherTenant = moveToOther;
      expect(insertOther).toBe(RLS_VIOLATION);
      expect(moveToOther).toBe(RLS_VIOLATION);
    });

    it.each([['nobody'], [''], ['T0001'], ["t0001' OR '1'='1"], ['t0001 '], ['%']])(
      'a wrong or malformed tenant setting (%j) sees nothing',
      async (value) => {
        await inTx(value, async () => {
          for (const table of SCOPED_TABLES) {
            const { rows } = await app.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
            expect(Number(rows[0]!.n)).toBe(0);
          }
        });
      },
    );

    it('a session-level SET by the login does not survive into another transaction... unless it is session level', async () => {
      // set_config(..., true) is transaction-local: gone after COMMIT.
      await app.query('BEGIN');
      await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [A]);
      await app.query('COMMIT');
      const after = await app.query<{ n: string }>(
        'SELECT count(*) AS n FROM content.content_item',
      );
      expect(Number(after.rows[0]!.n)).toBe(0);
      // Negative control: a session-level setting (is_local = false) does persist on the
      // connection. The UnitOfWork never issues it and the guard refuses any raw SQL but the
      // exact transaction-local text (session-statements.ts).
      await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, false)", [A]);
      const leaked = await app.query<{ n: string }>(
        'SELECT count(*) AS n FROM content.content_item',
      );
      states.sessionLevelSettingNegativeControl = Number(leaked.rows[0]!.n);
      expect(Number(leaked.rows[0]!.n)).toBe(contentCounts.get(A));
      await app.query('RESET app.tenant_id');
    });

    it('the app login cannot switch row-level security off or escape it', async () => {
      const attempts: Record<string, string | null> = {
        'ALTER TABLE ... DISABLE ROW LEVEL SECURITY': await sqlState(
          app.query('ALTER TABLE content.content_item DISABLE ROW LEVEL SECURITY'),
        ),
        'DROP POLICY': await sqlState(
          app.query('DROP POLICY content_item_tenant_isolation ON content.content_item'),
        ),
        'SET row_security = off, then SELECT': await sqlState(
          inTx(null, async () => {
            await app.query('SET LOCAL row_security = off');
            await app.query('SELECT count(*) FROM content.content_item');
          }),
        ),
        'SET ROLE phoenix_migrator': await sqlState(app.query('SET ROLE phoenix_migrator')),
        TRUNCATE: await sqlState(app.query('TRUNCATE forms.form_submission')),
        'CREATE FUNCTION in a schema': await sqlState(
          app.query('CREATE FUNCTION content.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'),
        ),
        'ALTER ROLE ... BYPASSRLS': await sqlState(app.query('ALTER ROLE phoenix_api BYPASSRLS')),
      };
      // COPY ... TO is allowed, but row-level security filters it like a SELECT.
      const copied = await inTx(null, () => app.query('COPY content.content_item TO STDOUT'));
      states.copyToStdoutRowsWithoutTenant = copied.rowCount;
      expect(copied.rowCount).toBe(0);
      states.privilegeEscapes = attempts;
      for (const [name, state] of Object.entries(attempts)) {
        expect([name, state]).toEqual([name, expect.stringMatching(/^(42501|0A000)$/)]);
      }
    });

    it('statistics views do not show other tenants values to the app login', async () => {
      const { rows } = await app.query(
        "SELECT attname FROM pg_stats WHERE schemaname = 'content' AND tablename = 'content_item'",
      );
      states.pgStatsRowsVisible = rows.length;
      expect(rows).toHaveLength(0);
      // Residual side channel, recorded and not a row leak: EXPLAIN shows the planner's
      // whole-table estimates (all tenants) to the login.
      const { rows: plan } = await app.query(
        'EXPLAIN (FORMAT JSON) SELECT * FROM content.content_item',
      );
      states.explainWholeTableEstimate = (
        plan[0] as { 'QUERY PLAN': [{ Plan: { 'Plan Rows': number } }] }
      )['QUERY PLAN'][0].Plan['Plan Rows'];
    });

    it('every tenant-scoped table has RLS enabled and the reference policy', async () => {
      const { rows } = await owner.query<{
        table_name: string;
        rls: boolean;
        forced: boolean;
        policies: number;
        good: number;
      }>(`
        SELECT n.nspname || '.' || c.relname AS table_name, c.relrowsecurity AS rls,
               c.relforcerowsecurity AS forced,
               (SELECT count(*) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname)::int AS policies,
               (SELECT count(*) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                   AND p.cmd = 'ALL' AND p.roles = '{phoenix_app}' AND p.permissive = 'PERMISSIVE'
                   AND p.qual = '((tenant_id)::text = platform.current_tenant_id())'
                   AND p.with_check = '((tenant_id)::text = platform.current_tenant_id())')::int AS good
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
         ORDER BY 1`);
      states.catalog = rows;
      expect(rows.map((row) => row.table_name).sort()).toEqual([...SCOPED_TABLES].sort());
      for (const row of rows) expect(row).toMatchObject({ rls: true, policies: 1, good: 1 });
    });
  });

  describe('pooled connections never carry a tenant into the next unit', () => {
    it('after commit, err, throw and timeout, the single pooled connection has no tenant', async () => {
      const single = createSpikePersistence(APP_URL, 'production', 1);
      const settings: Array<string | null> = [];
      const probe = async () => {
        const rows = await single.root.$queryRawUnsafe<Array<{ t: string | null; n: bigint }>>(
          "SELECT current_setting('app.tenant_id', true) AS t, (SELECT count(*) FROM content.content_item) AS n",
        );
        settings.push(rows[0]!.t);
        expect(rows[0]!.t ?? '').toBe('');
        expect(Number(rows[0]!.n)).toBe(0);
      };
      try {
        const read = () => single.service.tx(tenantA).contentItem.count({ where: { tenantId: A } });
        await single.unitOfWork.run(tenantA, async () => ok(await read()));
        await probe();
        await single.unitOfWork.run(tenantA, async () => err((await read()) > 0));
        await probe();
        await expect(
          single.unitOfWork.run(tenantA, async () => {
            await read();
            throw new Error('boom');
          }),
        ).rejects.toThrow('boom');
        await probe();
        await expect(
          single.unitOfWork.run(
            tenantA,
            async () => {
              await read();
              await new Promise((resolve) => setTimeout(resolve, 1500));
              return ok(await read());
            },
            { timeoutMs: 1000 },
          ),
        ).rejects.toThrow();
        await probe();
        await single.unitOfWork.run(tenantA, async () => ok(await read()), { readOnly: true });
        await probe();
      } finally {
        await single.close();
      }
      results.pooledConnectionSettings = settings;
    });
  });

  describe('concurrent units of 1000 tenants on one shared pool', () => {
    it('production path (UnitOfWork + guard + RLS): zero leaks', async () => {
      const report = await productionPathRun(APP_URL, 'postgres direct, production path');
      // Every write landed in the tenant it was written for.
      const ids = [...report.writtenByTenant.entries()].flatMap(([code, list]) =>
        list.map((id) => ({ code, id })),
      );
      const { rows } = await owner.query<{ id: string; tenant_id: string; written_for: string }>(
        `SELECT id, tenant_id, payload->>'writtenFor' AS written_for FROM forms.form_submission
          WHERE form_key = 'concurrency' AND id = ANY($1::uuid[])`,
        [ids.map((entry) => entry.id)],
      );
      const misplaced = rows.filter((row) => row.tenant_id !== row.written_for).length;
      const { writtenByTenant: written, ...summary } = report;
      expect(written.size).toBeGreaterThan(0);
      results.concurrentProductionPath = { ...summary, writesFound: rows.length, misplaced };
      expect(report.failures).toBe(0);
      expect(report.leaks).toBe(0);
      expect(rows).toHaveLength(report.writes);
      expect(misplaced).toBe(0);
      await owner.query("DELETE FROM forms.form_submission WHERE form_key = 'concurrency'");
    });

    it('design candidate (tenant set in the adapter): zero leaks, read-only still enforced', async () => {
      const report = await productionPathRun(
        APP_URL,
        'postgres direct, adapter-session candidate',
        {
          kind: 'adapter-session',
          seed: 3,
        },
      );
      const { writtenByTenant, ...summary } = report;
      const ids = [...writtenByTenant.values()].flat();
      const { rows } = await owner.query<{ misplaced: string; found: string }>(
        `SELECT count(*) FILTER (WHERE tenant_id <> payload->>'writtenFor') AS misplaced, count(*) AS found
           FROM forms.form_submission WHERE form_key = 'concurrency' AND id = ANY($1::uuid[])`,
        [ids],
      );
      const candidate = createSpikePersistence(APP_URL, 'adapter-session', 1);
      let readOnlyRefusal: string | null;
      try {
        const txState = await candidate.root.$transaction(async (tx) =>
          tx.$queryRawUnsafe<Array<{ t: string | null }>>(
            "SELECT current_setting('app.tenant_id', true) AS t",
          ),
        );
        // A transaction opened without a pending unit carries no tenant (fail closed).
        expect(txState[0]!.t ?? '').toBe('');
        // Below the guard (which refuses a write in a read-only unit first), the database refuses
        // it too: the adapter set transaction_read_only with the tenant.
        readOnlyRefusal = await sqlState(
          (async () => {
            await pendingSession.run({ tenantId: A, readOnly: true }, () =>
              candidate.root.$transaction(async (tx) => {
                const seen = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
                  'SELECT count(*) AS n FROM content.content_item',
                );
                expect(Number(seen[0]!.n)).toBe(contentCounts.get(A));
                await tx.$executeRawUnsafe(
                  "UPDATE content.content_item SET title = title WHERE tenant_id = 't0001'",
                );
              }),
            );
          })(),
        );
      } finally {
        await candidate.close();
      }
      results.concurrentAdapterSessionCandidate = {
        ...summary,
        writesFound: Number(rows[0]!.found),
        misplaced: Number(rows[0]!.misplaced),
        readOnlyRefusal,
      };
      expect(report.failures).toBe(0);
      expect(report.leaks).toBe(0);
      expect(Number(rows[0]!.misplaced)).toBe(0);
      expect(Number(rows[0]!.found)).toBe(report.writes);
      expect(readOnlyRefusal).toBe('25006');
      await owner.query("DELETE FROM forms.form_submission WHERE form_key = 'concurrency'");
    });

    it('RLS alone, raw SQL on a shared pg pool: zero leaks', async () => {
      const report = await rawRlsRun(APP_URL, 'postgres direct, raw SQL, RLS only');
      results.concurrentRawRls = report;
      expect(report.failures).toBe(0);
      expect(report.leaks).toBe(0);
    });
  });
});
