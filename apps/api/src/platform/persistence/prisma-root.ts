import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import type { AppConfig } from '../config/app-config';
import { CONNECTION_WAIT_MS } from '../unit-of-work/unit-of-work';

/** How long an idle pooled connection is kept . */
export const POOL_IDLE_TIMEOUT_MS = 30_000;

/**
 * The pool of the process (Mondapac platform persistence design 3.1 row 8):
 * at most 2 s to obtain a connection for every statement, so pool exhaustion fails fast in a
 * read-only unit too, and an explicit maximum (`DATABASE_POOL_MAX`). No statement name
 * generator: the application never uses named prepared statements (Mondapac data design 10.9).
 * `connectionWaitMs` is for the database test harness alone; the application keeps 2 s.
 */
export function poolConfigOf(
  config: AppConfig,
  connectionWaitMs: number = CONNECTION_WAIT_MS,
): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: connectionWaitMs,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  };
}

/** Client options a test may add (query events, a longer connection wait); never the adapter. */
export type PrismaRootOptions = Omit<Prisma.PrismaClientOptions, 'adapter' | 'accelerateUrl'> & {
  readonly connectionWaitMs?: number;
};

/**
 * The base client, without the tenant guard (P 3.3). Visible inside `platform/persistence/`
 * only: `PersistenceModule` does not export it, and dependency-cruiser keeps module code to
 * `prisma.service.ts`. Its users are the guarded client built on it and `DatabaseProbe`.
 */
export class PrismaRoot extends PrismaClient implements OnModuleDestroy {
  /** The pool's connection wait, also the `maxWait` of the root's own transactions. */
  readonly connectionWaitMs: number;

  constructor(
    config: AppConfig,
    { connectionWaitMs = CONNECTION_WAIT_MS, ...options }: PrismaRootOptions = {},
  ) {
    super({ ...options, adapter: new PrismaPg(poolConfigOf(config, connectionWaitMs)) });
    this.connectionWaitMs = connectionWaitMs;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
