// Allowed: the files of RAW_SQL_FILES and DRIVER_FILES run raw SQL and import the driver.
import { Pool } from 'pg';

declare const db: Record<string, (...args: unknown[]) => unknown>;

export const pool = Pool;
export const probe = (): unknown => db.$queryRaw('SELECT 1');
export const probes = (): unknown => (db as { platformProbe?: unknown }).platformProbe;
