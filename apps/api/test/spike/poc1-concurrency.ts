// SPIKE (PoC 1): concurrent units of many tenants on one shared pool. Used directly against
// PostgreSQL and through PgBouncer (transaction pooling).
import { ok } from '@phoenix/shared-kernel';
import {
  ALL_TENANTS,
  createSpikePersistence,
  ownerCounts,
  pick,
  pool,
  rng,
  runConcurrently,
  seedId,
  tenantOf,
  type UnitKind,
} from './poc1-support';
import { randomUUID } from 'node:crypto';

export interface ConcurrencyReport {
  readonly path: string;
  readonly units: number;
  readonly concurrency: number;
  readonly poolMax: number;
  readonly tenantsTouched: number;
  readonly checks: number;
  readonly leaks: number;
  readonly failures: number;
  readonly writes: number;
  readonly seconds: number;
}

/**
 * The production path: PrismaUnitOfWork + tenant guard + row-level security. Each unit picks a
 * random tenant and either reads (counts that must equal the owner's per-tenant counts, rows
 * whose tenantId must be the unit's) or writes a form submission. A unit whose app.tenant_id
 * were another tenant's would read 0 rows (count mismatch) or fail RLS's WITH CHECK on write.
 */
export async function productionPathRun(
  url: string,
  label: string,
  {
    units = 20_000,
    concurrency = 64,
    poolMax = 10,
    seed = 1,
    kind = 'production',
  }: {
    readonly units?: number;
    readonly concurrency?: number;
    readonly poolMax?: number;
    readonly seed?: number;
    readonly kind?: UnitKind;
  } = {},
): Promise<ConcurrencyReport & { readonly writtenByTenant: Map<string, string[]> }> {
  const persistence = createSpikePersistence(url, kind, poolMax);
  const content = await ownerCounts('content.content_item');
  const sites = await ownerCounts('site.site');
  const random = rng(seed);
  const touched = new Set<string>();
  const writtenByTenant = new Map<string, string[]>();
  let checks = 0;
  let leaks = 0;
  let failures = 0;
  let writes = 0;
  const started = Date.now();
  try {
    await runConcurrently(units, concurrency, async (index) => {
      const code = pick(random, ALL_TENANTS);
      const tenant = tenantOf(code);
      const tenantId = tenant.tenantId as string;
      touched.add(code);
      const kind = index % 4;
      try {
        if (kind === 3) {
          const id = randomUUID();
          await persistence.unitOfWork.run(tenant, async () => {
            await persistence.service.tx(tenant).formSubmission.create({
              data: {
                id,
                tenantId,
                siteId: seedId(`${code}/site/0`),
                formKey: 'concurrency',
                payload: { writtenFor: code },
                submittedAt: new Date('2026-10-27T00:00:00Z'),
              },
            });
            return ok(undefined);
          });
          writes += 1;
          writtenByTenant.set(code, [...(writtenByTenant.get(code) ?? []), id]);
          return;
        }
        const observed = await persistence.unitOfWork.run(
          tenant,
          async () => {
            const tx = persistence.service.tx(tenant);
            const [items, itemCount, siteCount] = await Promise.all([
              tx.contentItem.findMany({
                where: { tenantId },
                select: { tenantId: true },
                orderBy: { createdAt: 'desc' },
                take: 25,
              }),
              tx.contentItem.count({ where: { tenantId } }),
              tx.site.count({ where: { tenantId } }),
            ]);
            return ok({ items, itemCount, siteCount });
          },
          { readOnly: true },
        );
        if (!observed.ok) throw new Error('unexpected err result');
        const { items, itemCount, siteCount } = observed.value;
        checks += 3;
        if (items.length !== 25 || items.some((row) => row.tenantId !== code)) leaks += 1;
        if (itemCount !== content.get(code)) leaks += 1;
        if (siteCount !== sites.get(code)) leaks += 1;
      } catch (error) {
        failures += 1;
        if (failures < 5) console.error(label, error);
      }
    });
  } finally {
    await persistence.close();
  }
  return {
    path: label,
    units,
    concurrency,
    poolMax,
    tenantsTouched: touched.size,
    checks,
    leaks,
    failures,
    writes,
    seconds: (Date.now() - started) / 1000,
    writtenByTenant,
  };
}

/**
 * Row-level security alone, guard bypassed (the "guard has a bug" case): raw SQL of the
 * application login on a shared pg pool. Each unit sets one tenant with set_config(..., true)
 * and groups every row it can see by tenant_id across four tables; it must see exactly its own
 * tenant with the owner's counts. One unit in eight sets no tenant and must see nothing, which
 * also catches a setting left behind on a pooled connection.
 */
export async function rawRlsRun(
  url: string,
  label: string,
  { units = 20_000, concurrency = 64, poolMax = 10, seed = 2 } = {},
): Promise<ConcurrencyReport> {
  const db = pool(url, poolMax);
  const expected = {
    'content.content_item': await ownerCounts('content.content_item'),
    'site.site': await ownerCounts('site.site'),
    'site.site_ancestry': await ownerCounts('site.site_ancestry'),
    'identity.role_grant': await ownerCounts('identity.role_grant'),
  };
  const random = rng(seed);
  const touched = new Set<string>();
  let checks = 0;
  let leaks = 0;
  let failures = 0;
  const started = Date.now();
  try {
    await runConcurrently(units, concurrency, async (index) => {
      const code = index % 8 === 7 ? null : pick(random, ALL_TENANTS);
      if (code !== null) touched.add(code);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        if (code !== null) {
          await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [code]);
        }
        for (const [table, counts] of Object.entries(expected)) {
          const { rows } = await client.query<{ tenant_id: string; n: string }>(
            `SELECT tenant_id, count(*) AS n FROM ${table} GROUP BY tenant_id`,
          );
          checks += 1;
          if (code === null) {
            if (rows.length !== 0) leaks += 1;
          } else if (
            rows.length !== 1 ||
            rows[0]!.tenant_id !== code ||
            Number(rows[0]!.n) !== counts.get(code)
          ) {
            leaks += 1;
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        failures += 1;
        if (failures < 5) console.error(label, error);
        await client.query('ROLLBACK').catch(() => undefined);
      } finally {
        client.release();
      }
    });
  } finally {
    await db.end();
  }
  return {
    path: label,
    units,
    concurrency,
    poolMax,
    tenantsTouched: touched.size,
    checks,
    leaks,
    failures,
    writes: 0,
    seconds: (Date.now() - started) / 1000,
  };
}
