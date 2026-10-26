// Violations: every form of raw SQL and of the database driver that the check must see.
declare const db: Record<string, (...args: unknown[]) => unknown>;
declare const Prisma: Record<string, (...args: unknown[]) => unknown>;
declare const require: (specifier: string) => unknown;
declare const moduleName: string;

const { $queryRaw: renamed } = db;
const { ['$executeRawUnsafe']: computed } = db;
const extended = db.$extends();
const built = Prisma.sql('SELECT 1');
const viaElement = db['$executeRaw'];
const loadedDriver = require('pg');
const dynamicDriver = import('pg-pool');
const computedLoad = require(moduleName);

export { renamed, computed, extended, built, viaElement, loadedDriver, dynamicDriver };
export { computedLoad };
export * from 'postgres';
export * from '@prisma/adapter-pg';
