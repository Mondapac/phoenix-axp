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

// ADR-0002, the database's half of tenant isolation: Postgres row-level security on every
// tenant-scoped table, keyed on the transaction-local setting `app.tenant_id` that the
// UnitOfWork sets first in every unit. These tests talk to the database as the application
// login directly (no guard), so they prove what the database alone refuses.

const SQLSTATE_RLS_VIOLATION = '42501';

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * The one policy expression of every tenant-scoped table, as PostgreSQL prints it back
 * (pg_get_expr) for a `tenant_id varchar(32)` column: the USING and the WITH CHECK of the
 * reference policy (20261026120100 and 20261026120200).
 */
const REFERENCE_EXPRESSION = '((tenant_id)::text = platform.current_tenant_id())';

interface TableSecurity {
  relation: string;
  rls: boolean;
  forced: boolean;
  policies: {
    name: string;
    permissive: boolean;
    command: string;
    roles: string[];
    using: string | null;
    check: string | null;
  }[];
}

/** Every table with a `tenant_id` column (optionally only those named like `pattern`). */
async function tenantTables(client: Client, pattern = '%'): Promise<TableSecurity[]> {
  const { rows } = await client.query<TableSecurity>(
    `
    SELECT n.nspname || '.' || c.relname AS relation,
           c.relrowsecurity AS rls,
           c.relforcerowsecurity AS forced,
           COALESCE((
             SELECT json_agg(json_build_object(
                      'name', p.polname,
                      'permissive', p.polpermissive,
                      'command', p.polcmd,
                      'roles', (SELECT array_agg(CASE WHEN r = 0 THEN 'PUBLIC'
                                                      ELSE pg_catalog.pg_get_userbyid(r) END
                                                 ORDER BY 1)
                                  FROM unnest(p.polroles) AS r),
                      'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
                      'check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid))
                    ORDER BY p.polname)
               FROM pg_catalog.pg_policy p
              WHERE p.polrelid = c.oid), '[]'::json) AS policies
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND c.relname LIKE $1
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     ORDER BY 1`,
    [pattern],
  );
  return rows;
}

/**
 * What separates a table from the reference: RLS enabled and forced, and exactly one policy,
 * permissive, for all commands, to phoenix_app only, whose USING and WITH CHECK are exactly
 * REFERENCE_EXPRESSION. A `LIKE '%current_tenant_id()%'` match would let `... OR true` or a
 * second permissive policy through (security review S2-2).
 */
function policyProblems(table: TableSecurity): string[] {
  const problems: string[] = [];
  const at = table.relation;
  if (!table.rls) problems.push(`${at}: row-level security is not enabled`);
  if (!table.forced) {
    problems.push(`${at}: row-level security is not forced (the owner would bypass it)`);
  }
  if (table.policies.length !== 1) {
    problems.push(
      `${at}: ${table.policies.length} policies ` +
        `(${table.policies.map((p) => p.name).join(', ')}), expected exactly one`,
    );
    return problems;
  }
  const [policy] = table.policies as [TableSecurity['policies'][number]];
  const named = `${at}: policy ${policy.name}`;
  if (!policy.permissive) problems.push(`${named} is RESTRICTIVE, expected PERMISSIVE`);
  if (policy.command !== '*') {
    problems.push(`${named} is for command ${policy.command}, expected * (ALL)`);
  }
  if (policy.roles.join(',') !== 'phoenix_app') {
    problems.push(`${named} applies to {${policy.roles.join(',')}}, expected {phoenix_app}`);
  }
  if (policy.using !== REFERENCE_EXPRESSION) {
    problems.push(`${named} USING is "${policy.using ?? ''}", expected "${REFERENCE_EXPRESSION}"`);
  }
  if (policy.check !== REFERENCE_EXPRESSION) {
    problems.push(
      `${named} WITH CHECK is "${policy.check ?? ''}", expected "${REFERENCE_EXPRESSION}"`,
    );
  }
  return problems;
}

describe('row-level security (database integration, ADR-0002)', () => {
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

  it('the rows of both tenants exist (each seen under its own tenant setting)', async () => {
    for (const code of TEST_TENANTS) {
      const visible = await inTransaction(async () => {
        await setTenant(code);
        return labels();
      });
      expect(visible).toEqual(expect.arrayContaining(seeded.get(code)!));
    }
  });

  it('the owner (the migration role) is subject to the policy too: FORCE, so it sees no row', async () => {
    const { rows } = await owner.query<{ count: string }>(
      'SELECT count(*) FROM platform.isolation_probe',
    );
    expect(Number(rows[0]!.count)).toBe(0);
    await owner.query('BEGIN');
    try {
      // Even with a tenant set: the policy names phoenix_app only, so the owner matches none.
      await owner.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
        TEST_TENANTS[0],
      ]);
      const seen = await owner.query('SELECT label FROM platform.isolation_probe');
      expect(seen.rowCount).toBe(0);
      await expect(
        owner.query(
          'INSERT INTO platform.isolation_probe (id, tenant_id, label, created_at) ' +
            'VALUES (gen_random_uuid(), $1, $2, now())',
          [TEST_TENANTS[0], uniqueLabel()],
        ),
      ).rejects.toMatchObject({ code: SQLSTATE_RLS_VIOLATION });
    } finally {
      await owner.query('ROLLBACK');
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

  describe('the catalogue: every table with a tenant_id column (S2-1, S2-2)', () => {
    it('has row-level security enabled and forced, and exactly the reference policy', async () => {
      const tables = await tenantTables(owner);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables.flatMap(policyProblems)).toEqual([]);
    });

    /**
     * Creates `ddl` in a transaction of the owner, runs the check on the tables it made (named
     * `zz_rls_*`), and rolls everything back.
     */
    async function problemsOf(ddl: string): Promise<string[]> {
      await owner.query('BEGIN');
      try {
        await owner.query(ddl);
        const tables = await tenantTables(owner, 'zz\\_rls\\_%');
        expect(tables.length).toBeGreaterThan(0);
        return tables.flatMap(policyProblems);
      } finally {
        await owner.query('ROLLBACK');
      }
    }

    const table = (name: string) => `
      CREATE TABLE platform.${name} (id uuid PRIMARY KEY, tenant_id varchar(32) NOT NULL);
      ALTER TABLE platform.${name} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE platform.${name} FORCE ROW LEVEL SECURITY;`;
    const reference = (name: string, using = REFERENCE_EXPRESSION) => `
      CREATE POLICY ${name}_tenant_isolation ON platform.${name}
        AS PERMISSIVE FOR ALL TO phoenix_app
        USING (${using}) WITH CHECK (tenant_id = platform.current_tenant_id());`;

    it('accepts a table built exactly like the reference (control)', async () => {
      expect(await problemsOf(table('zz_rls_ok') + reference('zz_rls_ok'))).toEqual([]);
    });

    it('catches a weakened USING: ... OR true', async () => {
      expect(
        await problemsOf(
          table('zz_rls_or_true') +
            reference('zz_rls_or_true', 'tenant_id = platform.current_tenant_id() OR true'),
        ),
      ).toEqual([
        'platform.zz_rls_or_true: policy zz_rls_or_true_tenant_isolation USING is ' +
          '"(((tenant_id)::text = platform.current_tenant_id()) OR true)", ' +
          `expected "${REFERENCE_EXPRESSION}"`,
      ]);
    });

    it('catches an extra permissive policy beside the reference one', async () => {
      expect(
        await problemsOf(
          table('zz_rls_extra') +
            reference('zz_rls_extra') +
            'CREATE POLICY zz_rls_extra_open ON platform.zz_rls_extra USING (true);',
        ),
      ).toEqual([
        'platform.zz_rls_extra: 2 policies (zz_rls_extra_open, zz_rls_extra_tenant_isolation), ' +
          'expected exactly one',
      ]);
    });

    it('catches row-level security that is enabled but not forced, or not enabled', async () => {
      expect(
        await problemsOf(`
          CREATE TABLE platform.zz_rls_unforced (id uuid PRIMARY KEY, tenant_id varchar(32) NOT NULL);
          ALTER TABLE platform.zz_rls_unforced ENABLE ROW LEVEL SECURITY;
          ${reference('zz_rls_unforced')}
          CREATE TABLE platform.zz_rls_off (id uuid PRIMARY KEY, tenant_id varchar(32) NOT NULL);
          ${reference('zz_rls_off')}`),
      ).toEqual([
        'platform.zz_rls_off: row-level security is not enabled',
        'platform.zz_rls_off: row-level security is not forced (the owner would bypass it)',
        'platform.zz_rls_unforced: row-level security is not forced (the owner would bypass it)',
      ]);
    });

    it('catches a policy for one command, for another role, restrictive or without WITH CHECK', async () => {
      expect(
        await problemsOf(`
          ${table('zz_rls_select')}
          CREATE POLICY p ON platform.zz_rls_select FOR SELECT TO phoenix_app
            USING (tenant_id = platform.current_tenant_id());
          ${table('zz_rls_public')}
          CREATE POLICY p ON platform.zz_rls_public AS RESTRICTIVE
            USING (tenant_id = platform.current_tenant_id());`),
      ).toEqual([
        'platform.zz_rls_public: policy p is RESTRICTIVE, expected PERMISSIVE',
        'platform.zz_rls_public: policy p applies to {PUBLIC}, expected {phoenix_app}',
        'platform.zz_rls_public: policy p WITH CHECK is "", ' +
          `expected "${REFERENCE_EXPRESSION}"`,
        'platform.zz_rls_select: policy p is for command r, expected * (ALL)',
        'platform.zz_rls_select: policy p WITH CHECK is "", ' +
          `expected "${REFERENCE_EXPRESSION}"`,
      ]);
    });
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
