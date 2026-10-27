// SPIKE (PoC 1, slice 0.6): shared helpers of the isolation tests and the measurements.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import { Client, Pool } from 'pg';
import { MODEL_MAP } from '../../src/generated/model-map';
import {
  createGuardedClient,
  modelDelegatesOf,
  type GuardedClient,
} from '../../src/platform/persistence/guarded-client';
import { AdapterSessionUnitOfWork } from '../../src/platform/persistence/adapter-session-unit-of-work';
import { PrismaRoot } from '../../src/platform/persistence/prisma-root';
import { PrismaService } from '../../src/platform/persistence/prisma.service';
import { PrismaUnitOfWork } from '../../src/platform/persistence/prisma-unit-of-work';
import { OpenUnit, unitStorage } from '../../src/platform/persistence/unit-store';
import type { UnitOfWork, UnitOfWorkOptions } from '../../src/platform/unit-of-work/unit-of-work';
import { testAppConfig } from '../support/test-config';

export const REPO_ROOT = path.resolve(__dirname, '../../../..');
const HOST = process.env.POC_PGHOST ?? '127.0.0.1';
const PORT = process.env.POC_PGPORT ?? '5433';
const BOUNCER_PORT = process.env.POC_PGBOUNCER_PORT ?? '6433';

const url = (user: string, port: string, db: string): string =>
  `postgresql://${user}:${user}@${HOST}:${port}/${db}`;

/** The seeded database with row-level security, as the application login. */
export const APP_URL = url('phoenix_api', PORT, 'phoenix_poc');
/** The same data with row-level security switched off on every table (baseline). */
export const APP_NORLS_URL = url('phoenix_api', PORT, 'phoenix_poc_norls');
/** The seeded database as its owner (the migration role): sees every tenant. */
export const OWNER_URL = url('phoenix_migrator', PORT, 'phoenix_poc');
/** Through PgBouncer in transaction-pooling mode. */
export const BOUNCER_URL = url('phoenix_api', BOUNCER_PORT, 'phoenix_poc');
export const BOUNCER_NORLS_URL = url('phoenix_api', BOUNCER_PORT, 'phoenix_poc_norls');

export const TENANT_COUNT = 1000;
export const tenantCode = (n: number): string => `t${String(n).padStart(4, '0')}`;
export const ALL_TENANTS: readonly string[] = Array.from({ length: TENANT_COUNT }, (_, i) =>
  tenantCode(i + 1),
);
export const MINISTRY = 'ministry';
export const tenantOf = (code: string): TenantContext => testTenantContext(code);

/** The tenant-scoped tables of the spike, by schema-qualified name. */
export const SCOPED_TABLES = [
  'platform.isolation_probe',
  'site.site',
  'site.site_ancestry',
  'content.content_item',
  'forms.form_submission',
  'identity.staff_account',
  'identity.staff_session',
  'identity.role',
  'identity.role_grant',
] as const;

/** md5(name)::uuid, as the seed builds its ids. */
export { createHash } from 'node:crypto';
import { createHash } from 'node:crypto';
export function seedId(name: string): string {
  const hex = createHash('md5').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The persistence of one process, as PersistenceModule builds it, on any database URL. */
export interface SpikePersistence {
  readonly root: PrismaRoot;
  readonly client: GuardedClient;
  readonly service: PrismaService;
  readonly unitOfWork: UnitOfWork;
  close(): Promise<void>;
}

export type UnitKind = 'production' | 'guard-only' | 'adapter-session';

/**
 * `production`: the skeleton's PrismaUnitOfWork (every unit a transaction that sets
 * app.tenant_id first). `guard-only`: the Mondapac baseline, the tenant guard alone, with
 * read-only units outside a transaction and no tenant setting (GuardOnlyUnitOfWork below).
 */
export function createSpikePersistence(
  databaseUrl: string,
  kind: UnitKind = 'production',
  poolMax = 10,
): SpikePersistence {
  const config = testAppConfig({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: String(poolMax) });
  const root = new PrismaRoot(config, {
    connectionWaitMs: 30_000,
    tenantSessionInAdapter: kind === 'adapter-session',
  });
  const client = createGuardedClient(root, MODEL_MAP);
  const unitOfWork =
    kind === 'production'
      ? new PrismaUnitOfWork(client, MODEL_MAP, undefined, 30_000)
      : kind === 'guard-only'
        ? new GuardOnlyUnitOfWork(client)
        : new AdapterSessionUnitOfWork(client, 30_000);
  return {
    root,
    client,
    service: new PrismaService(),
    unitOfWork,
    close: () => root.$disconnect(),
  };
}

class Rollback<E> extends Error {
  constructor(readonly result: Result<never, E>) {
    super('rolled back');
  }
}

/**
 * The baseline of the overhead measurement: Mondapac's persistence without row-level security.
 * The tenant guard checks every query exactly as in production; a read-only unit runs outside a
 * transaction (Mondapac ADR-0025) and no unit sets app.tenant_id. Only valid against the
 * database copy whose tables have row-level security switched off.
 */
export class GuardOnlyUnitOfWork implements UnitOfWork {
  constructor(private readonly client: GuardedClient) {}

  async run<T, E>(
    tenant: TenantContext,
    work: () => Promise<Result<T, E>>,
    options: UnitOfWorkOptions = {},
  ): Promise<Result<T, E>> {
    if (options.readOnly === true) {
      const unit = new OpenUnit(tenant, true, modelDelegatesOf(this.client, MODEL_MAP));
      try {
        return await unitStorage.run(unit, work);
      } finally {
        unit.close();
      }
    }
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const unit = new OpenUnit(tenant, false, modelDelegatesOf(transaction, MODEL_MAP));
          try {
            const result = await unitStorage.run(unit, work);
            if (!result.ok) throw new Rollback(result);
            return result;
          } finally {
            unit.close();
          }
        },
        { maxWait: 30_000, timeout: 5000 },
      );
    } catch (error) {
      if (error instanceof Rollback) return error.result;
      throw error;
    }
  }
}

export async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

export function pool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max });
}

/** Per-tenant row counts, read by the owner (who sees every tenant). */
export async function ownerCounts(table: string): Promise<Map<string, number>> {
  const owner = await connect(OWNER_URL);
  try {
    const { rows } = await owner.query<{ tenant_id: string; n: string }>(
      `SELECT tenant_id, count(*) AS n FROM ${table} GROUP BY tenant_id`,
    );
    return new Map(rows.map((row) => [row.tenant_id, Number(row.n)]));
  } finally {
    await owner.end();
  }
}

/** A small deterministic generator (mulberry32), so runs are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!;

/** Runs `count` tasks with at most `concurrency` in flight. */
export async function runConcurrently(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < count) {
      const index = next;
      next += 1;
      await task(index);
    }
  });
  await Promise.all(workers);
}

export interface LatencyStats {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export function stats(samples: readonly number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    n: sorted.length,
    mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
  };
}

export async function timeMs(work: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await work();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

export function writeResult(name: string, value: unknown): void {
  writeFileSync(
    path.join(REPO_ROOT, 'spike/poc-1/results', `${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}
