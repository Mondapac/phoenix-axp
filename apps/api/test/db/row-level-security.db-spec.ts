import { ok } from '@phoenix/shared-kernel';
import { Client } from 'pg';
import { TEST_TENANTS } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  probeRow,
  tenantOf,
  uniqueLabel,
  type Persistence,
} from './persistence-support';
import { ownerTestDatabaseUrl, testDatabaseUrl } from './test-database';

// ADR-02, the database's half of tenant isolation: Postgres row-level security on every
// tenant-scoped table, keyed on the transaction-local setting `app.tenant_id` that the
// UnitOfWork sets first in every unit. These tests talk to the database as the application
// login directly (no guard), so they prove what the database alone refuses.

const SQLSTATE_RLS_VIOLATION = '42501';

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

describe('row-level security (database integration, ADR-02)', () => {
  let persistence: Persistence;
  let app: Client;
  let owner: Client;
  /** The labels of the rows seeded for each tenant through the UnitOfWork. */
  const seeded = new Map<string, string[]>();

  beforeAll(async () => {
    persistence = createPersistence();
    app = await connect(testDatabaseUrl());
    owner = await connect(ownerTestDatabaseUrl());
    for (const code of TEST_TENANTS) {
      const tenant = tenantOf(code);
      const rows = [probeRow(tenant), probeRow(tenant)];
      await persistence.unitOfWork.run(tenant, async () => {
        await persistence.service.tx(tenant).isolationProbe.createMany({ data: rows });
        return ok(undefined);
      });
      seeded.set(
        code,
        rows.map((row) => row.label),
      );
    }
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
    await persistence.close();
  });

  /** Runs `work` in a transaction of the application login, rolled back afterwards. */
  async function inTransaction<T>(work: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      return await work();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  const setTenant = (tenantId: string) =>
    app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantId]);

  const labels = async (): Promise<string[]> =>
    (await app.query<{ label: string }>('SELECT label FROM platform.isolation_probe')).rows.map(
      (row) => row.label,
    );

  it('the rows of both tenants exist (seen by the owner, who is not subject to the policy)', async () => {
    const { rows } = await owner.query<{ tenant_id: string; count: string }>(
      'SELECT tenant_id, count(*) FROM platform.isolation_probe GROUP BY tenant_id',
    );
    for (const code of TEST_TENANTS) {
      expect(Number(rows.find((row) => row.tenant_id === code)?.count)).toBeGreaterThanOrEqual(2);
    }
  });

  it('a query without the tenant setting sees no rows', async () => {
    expect(await labels()).toEqual([]);
    expect(await inTransaction(labels)).toEqual([]);
    const { rows } = await app.query<{ count: string }>(
      'SELECT count(*) FROM platform.isolation_probe',
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('an empty setting counts as no tenant', async () => {
    expect(
      await inTransaction(async () => {
        await setTenant('');
        return labels();
      }),
    ).toEqual([]);
  });

  describe.each(TEST_TENANTS)('with the setting of %s', (code) => {
    const other = otherTenantOf(code);

    it("sees its own rows and none of the other tenant's", async () => {
      const visible = await inTransaction(async () => {
        await setTenant(code);
        return labels();
      });
      expect(visible).toEqual(expect.arrayContaining(seeded.get(code)!));
      for (const label of seeded.get(other)!) expect(visible).not.toContain(label);
    });

    it("cannot update or delete the other tenant's rows: they are invisible", async () => {
      const changed = await inTransaction(async () => {
        await setTenant(code);
        const updated = await app.query(
          "UPDATE platform.isolation_probe SET label = 'stolen' WHERE tenant_id = $1",
          [other],
        );
        const deleted = await app.query(
          'DELETE FROM platform.isolation_probe WHERE tenant_id = $1',
          [other],
        );
        return [updated.rowCount, deleted.rowCount];
      });
      expect(changed).toEqual([0, 0]);
    });

    it('refuses to insert a row of the other tenant (WITH CHECK)', async () => {
      await expect(
        inTransaction(async () => {
          await setTenant(code);
          await app.query(
            'INSERT INTO platform.isolation_probe (id, tenant_id, label, created_at) ' +
              'VALUES (gen_random_uuid(), $1, $2, now())',
            [other, uniqueLabel()],
          );
        }),
      ).rejects.toMatchObject({ code: SQLSTATE_RLS_VIOLATION });
    });

    it('refuses to move one of its rows to the other tenant (WITH CHECK on update)', async () => {
      await expect(
        inTransaction(async () => {
          await setTenant(code);
          await app.query('UPDATE platform.isolation_probe SET tenant_id = $1 WHERE label = $2', [
            other,
            seeded.get(code)![0],
          ]);
        }),
      ).rejects.toMatchObject({ code: SQLSTATE_RLS_VIOLATION });
    });

    it('refuses to insert any row without the setting', async () => {
      await expect(
        app.query(
          'INSERT INTO platform.isolation_probe (id, tenant_id, label, created_at) ' +
            'VALUES (gen_random_uuid(), $1, $2, now())',
          [code, uniqueLabel()],
        ),
      ).rejects.toMatchObject({ code: SQLSTATE_RLS_VIOLATION });
    });

    it('the setting ends with the transaction: the connection is clean afterwards', async () => {
      await inTransaction(() => setTenant(code));
      const { rows } = await app.query<{ tenant: string | null }>(
        'SELECT platform.current_tenant_id() AS tenant',
      );
      expect(rows[0]!.tenant).toBeNull();
      expect(await labels()).toEqual([]);
    });
  });

  it('the UnitOfWork leaves no tenant on a pooled connection after the unit', async () => {
    // One connection in the pool, so the next statement reuses the unit's connection.
    const single = createPersistence({ env: { DATABASE_POOL_MAX: '1' } });
    try {
      for (const code of TEST_TENANTS) {
        const tenant = tenantOf(code);
        const seen = await single.unitOfWork.run(
          tenant,
          async () =>
            ok(await single.service.tx(tenant).isolationProbe.count({ where: { tenantId: code } })),
          { readOnly: true },
        );
        expect(seen.ok && typeof seen.value).toBe('number');
        const after = await single.root.$queryRaw<{ tenant: string | null }[]>`
          SELECT platform.current_tenant_id() AS tenant`;
        expect(after).toEqual([{ tenant: null }]);
      }
    } finally {
      await single.close();
    }
  });

  it('every table with a tenant_id column has row-level security and a tenant policy', async () => {
    const { rows } = await owner.query<{
      relation: string;
      rls: boolean;
      policies: string[] | null;
    }>(`
      SELECT n.nspname || '.' || c.relname AS relation,
             c.relrowsecurity AS rls,
             (SELECT array_agg(p.polname::text ORDER BY p.polname)
                FROM pg_catalog.pg_policy p
               WHERE p.polrelid = c.oid
                 AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%current_tenant_id()%'
                 AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%current_tenant_id()%'
             ) AS policies
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       ORDER BY 1`);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect({ relation: row.relation, rls: row.rls }).toEqual({
        relation: row.relation,
        rls: true,
      });
      expect(row.policies?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('the application login cannot switch row-level security off for itself', async () => {
    await expect(app.query('SET row_security = off')).resolves.toBeDefined();
    // With row_security off, a query that the policy would filter fails instead of bypassing.
    await expect(app.query('SELECT label FROM platform.isolation_probe')).rejects.toMatchObject({
      code: SQLSTATE_RLS_VIOLATION,
    });
    await app.query('RESET row_security');
  });
});
