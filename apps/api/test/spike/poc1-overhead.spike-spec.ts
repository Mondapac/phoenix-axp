// SPIKE (PoC 1, slice 0.6): what row-level security costs on top of the tenant guard.
//
// Every sample is one whole unit of work, as a use case pays it. Variants, same data:
//   guard-only      Mondapac's baseline: tenant guard, read-only units outside a transaction,
//                   no tenant setting; database copy with RLS switched off
//   guard+tx        the production UnitOfWork (transaction + set_config) on the RLS-off copy:
//                   isolates the cost of the policies themselves
//   guard+RLS       production: the UnitOfWork, the guard and the policies
//   ... via pgbouncer: guard-only and guard+RLS again through PgBouncer (transaction mode)
// Variants run interleaved in rounds (rotating order) so drift on the machine hits all alike.
import { ok } from '@phoenix/shared-kernel';
import { randomUUID } from 'node:crypto';
import { anyGrantCoversSite } from '../../src/modules/site';
import {
  ALL_TENANTS,
  APP_NORLS_URL,
  APP_URL,
  BOUNCER_NORLS_URL,
  BOUNCER_URL,
  MINISTRY,
  connect,
  createSpikePersistence,
  pick,
  rng,
  runConcurrently,
  seedId,
  stats,
  tenantOf,
  timeMs,
  writeResult,
  type LatencyStats,
  type SpikePersistence,
} from './poc1-support';

const ROUNDS = Number(process.env.POC_ROUNDS ?? 10);
const PER_ROUND = Number(process.env.POC_PER_ROUND ?? 100);
const WARMUP = 100;

const VARIANTS = {
  'guard-only': () => createSpikePersistence(APP_NORLS_URL, 'guard-only'),
  'guard+tx (policies off)': () => createSpikePersistence(APP_NORLS_URL, 'production'),
  'guard+RLS': () => createSpikePersistence(APP_URL, 'production'),
  'guard+RLS, tenant set in adapter': () => createSpikePersistence(APP_URL, 'adapter-session'),
  'guard-only via pgbouncer': () => createSpikePersistence(BOUNCER_NORLS_URL, 'guard-only'),
  'guard+RLS via pgbouncer': () => createSpikePersistence(BOUNCER_URL, 'production'),
} as const;
type Variant = keyof typeof VARIANTS;

type Op = (p: SpikePersistence, random: () => number) => Promise<unknown>;

const ministry = tenantOf(MINISTRY);
const site = (n: number): string => seedId(`ministry/site/${n}`);
const PROVINCE_1 = site(11);
const LEAF = site(444);
const ROOT = site(0);

function randomTenant(random: () => number) {
  const code = pick(random, ALL_TENANTS);
  return { code, tenant: tenantOf(code) };
}

async function read<T>(p: SpikePersistence, code: string, work: () => Promise<T>): Promise<T> {
  const result = await p.unitOfWork.run(tenantOf(code), async () => ok(await work()), {
    readOnly: true,
  });
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** Latest 20 items in the subtree of `root`: site module, then content module (no cross join). */
async function subtreePage(p: SpikePersistence, root: string) {
  return read(p, MINISTRY, async () => {
    const tx = p.service.tx(ministry);
    const sites = await tx.siteAncestry.findMany({
      where: { tenantId: MINISTRY, ancestorId: root },
      select: { descendantId: true },
    });
    return tx.contentItem.findMany({
      where: { tenantId: MINISTRY, ownerSiteId: { in: sites.map((row) => row.descendantId) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, ownerSiteId: true, createdAt: true },
    });
  });
}

const OPS: Record<string, Op> = {
  'read: item by id': (p, random) => {
    const { code, tenant } = randomTenant(random);
    const id = seedId(`${code}/item/${1 + Math.floor(random() * 200)}`);
    return read(p, code, () =>
      p.service.tx(tenant).contentItem.findFirst({ where: { tenantId: code, id } }),
    );
  },
  'read: latest 20 of a site': (p, random) => {
    const { code, tenant } = randomTenant(random);
    return read(p, code, () =>
      p.service.tx(tenant).contentItem.findMany({
        where: { tenantId: code, ownerSiteId: seedId(`${code}/site/0`) },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, title: true, status: true, createdAt: true },
      }),
    );
  },
  'read: count published': (p, random) => {
    const { code, tenant } = randomTenant(random);
    return read(p, code, () =>
      p.service.tx(tenant).contentItem.count({ where: { tenantId: code, status: 'published' } }),
    );
  },
  'write: insert submission': async (p, random) => {
    const { code, tenant } = randomTenant(random);
    await p.unitOfWork.run(tenant, async () => {
      await p.service.tx(tenant).formSubmission.create({
        data: {
          id: randomUUID(),
          tenantId: code,
          siteId: seedId(`${code}/site/0`),
          formKey: 'bench',
          payload: { name: 'Bench', message: 'Hello' },
          submittedAt: new Date('2026-10-27T00:00:00Z'),
        },
      });
      return ok(undefined);
    });
  },
  'write: update item': async (p, random) => {
    const { code, tenant } = randomTenant(random);
    const id = seedId(`${code}/item/${1 + Math.floor(random() * 200)}`);
    await p.unitOfWork.run(tenant, async () => {
      await p.service.tx(tenant).contentItem.updateMany({
        where: { tenantId: code, id },
        data: {
          title: `Edited ${Math.floor(random() * 1e6)}`,
          updatedAt: new Date('2026-10-27T00:00:00Z'),
        },
      });
      return ok(undefined);
    });
  },
  'ministry: subtree access check': (p, random) => {
    const principal = seedId(`ministry/principal/${1 + Math.floor(random() * 200)}`);
    const target = site(Math.floor(random() * 500));
    return read(p, MINISTRY, async () => {
      const tx = p.service.tx(ministry);
      const [grants, ancestors] = await Promise.all([
        tx.roleGrant.findMany({
          where: { tenantId: MINISTRY, principalId: principal },
          select: { siteId: true, includeDescendants: true },
        }),
        tx.siteAncestry.findMany({
          where: { tenantId: MINISTRY, descendantId: target },
          select: { ancestorId: true, depth: true },
        }),
      ]);
      return anyGrantCoversSite(grants, new Map(ancestors.map((a) => [a.ancestorId, a.depth])));
    });
  },
  'ministry: subtree page, root (500 sites)': (p) => subtreePage(p, ROOT),
  'ministry: subtree page, province (17 sites)': (p) => subtreePage(p, PROVINCE_1),
  'ministry: subtree page, leaf (1 site)': (p) => subtreePage(p, LEAF),
};

interface OpResult {
  readonly variants: Record<Variant, LatencyStats>;
  /** (guard+RLS p50 / guard-only p50) - 1, in percent; likewise for p95. */
  readonly overheadVsGuardOnly: { p50: number; p95: number };
  readonly policyOnlyOverhead: { p50: number; p95: number };
  readonly adapterSessionVsGuardOnly: { p50: number; p95: number };
  readonly overheadViaPgbouncer: { p50: number; p95: number };
}

const pct = (a: number, b: number): number => Math.round((a / b - 1) * 1000) / 10;

describe('PoC 1: overhead of RLS + guard against guard alone', () => {
  const persistences = {} as Record<Variant, SpikePersistence>;
  const report: Record<string, unknown> = {
    rounds: ROUNDS,
    perRound: PER_ROUND,
    warmup: WARMUP,
    node: process.version,
  };

  beforeAll(async () => {
    for (const variant of Object.keys(VARIANTS) as Variant[]) {
      persistences[variant] = VARIANTS[variant]();
    }
    const owner = await connect(
      APP_URL.replace('phoenix_api:phoenix_api', 'phoenix_migrator:phoenix_migrator'),
    );
    const { rows } = await owner.query<{ v: string }>('SELECT version() AS v');
    report.postgres = rows[0]!.v;
    await owner.end();
  });

  afterAll(async () => {
    writeResult('overhead', report);
    for (const persistence of Object.values(persistences)) await persistence.close();
  });

  it('sequential latency per representative unit (concurrency 1)', async () => {
    const variants = Object.keys(VARIANTS) as Variant[];
    const perOp: Record<string, OpResult> = {};
    for (const [name, op] of Object.entries(OPS)) {
      const samples = Object.fromEntries(variants.map((v) => [v, [] as number[]])) as Record<
        Variant,
        number[]
      >;
      for (const variant of variants) {
        const random = rng(7);
        for (let i = 0; i < WARMUP; i += 1) await op(persistences[variant], random);
      }
      for (let round = 0; round < ROUNDS; round += 1) {
        const order = variants.map((_, i) => variants[(i + round) % variants.length]!);
        for (const variant of order) {
          const random = rng(1000 + round);
          for (let i = 0; i < PER_ROUND; i += 1) {
            samples[variant].push(await timeMs(() => op(persistences[variant], random)));
          }
        }
      }
      const s = Object.fromEntries(variants.map((v) => [v, stats(samples[v])])) as Record<
        Variant,
        LatencyStats
      >;
      perOp[name] = {
        variants: s,
        overheadVsGuardOnly: {
          p50: pct(s['guard+RLS'].p50, s['guard-only'].p50),
          p95: pct(s['guard+RLS'].p95, s['guard-only'].p95),
        },
        policyOnlyOverhead: {
          p50: pct(s['guard+RLS'].p50, s['guard+tx (policies off)'].p50),
          p95: pct(s['guard+RLS'].p95, s['guard+tx (policies off)'].p95),
        },
        adapterSessionVsGuardOnly: {
          p50: pct(s['guard+RLS, tenant set in adapter'].p50, s['guard-only'].p50),
          p95: pct(s['guard+RLS, tenant set in adapter'].p95, s['guard-only'].p95),
        },
        overheadViaPgbouncer: {
          p50: pct(s['guard+RLS via pgbouncer'].p50, s['guard-only via pgbouncer'].p50),
          p95: pct(s['guard+RLS via pgbouncer'].p95, s['guard-only via pgbouncer'].p95),
        },
      };
      console.log(name, JSON.stringify(perOp[name]));
    }
    report.sequential = perOp;
  });

  it('concurrent mixed load (32 in flight, pool of 10 per variant)', async () => {
    const mix = [
      'read: item by id',
      'read: latest 20 of a site',
      'read: latest 20 of a site',
      'read: count published',
      'write: insert submission',
      'write: update item',
      'ministry: subtree access check',
      'ministry: subtree page, province (17 sites)',
    ];
    const variants = Object.keys(VARIANTS) as Variant[];
    const out: Record<string, unknown> = {};
    for (let round = 0; round < 3; round += 1) {
      for (const variant of variants.map((_, i) => variants[(i + round) % variants.length]!)) {
        const random = rng(5000 + round);
        const latencies: number[] = [];
        const started = process.hrtime.bigint();
        await runConcurrently(3000, 32, async () => {
          const op = OPS[pick(random, mix)]!;
          latencies.push(await timeMs(() => op(persistences[variant], random)));
        });
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const entry = (out[variant] ??= { runs: [] as unknown[] }) as { runs: unknown[] };
        entry.runs.push({ ...stats(latencies), unitsPerSecond: Math.round(3000 / seconds) });
      }
    }
    report.concurrent = out;
    console.log(JSON.stringify(out, null, 1));
  });

  it('query plans under RLS use the tenant-leading indexes', async () => {
    const app = await connect(APP_URL);
    const plans: Record<string, string[]> = {};
    const explain = async (name: string, tenant: string, sql: string, params: unknown[]) => {
      await app.query('BEGIN');
      await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
      const { rows } = await app.query(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${sql}`, params);
      await app.query('ROLLBACK');
      plans[name] = rows.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']);
    };
    await explain(
      'latest 20 of a site',
      't0500',
      `SELECT id FROM content.content_item WHERE tenant_id = $1 AND owner_site_id = $2 ORDER BY created_at DESC LIMIT 20`,
      ['t0500', seedId('t0500/site/0')],
    );
    await explain(
      'count published',
      't0500',
      `SELECT count(*) FROM content.content_item WHERE tenant_id = $1 AND status = 'published'`,
      ['t0500'],
    );
    await explain(
      'subtree page, root',
      MINISTRY,
      `SELECT id FROM content.content_item WHERE tenant_id = $1 AND owner_site_id IN (SELECT descendant_id FROM site.site_ancestry WHERE tenant_id = $1 AND ancestor_id = $2) ORDER BY created_at DESC LIMIT 20`,
      [MINISTRY, ROOT],
    );
    await app.end();
    report.plans = plans;
  });
});
