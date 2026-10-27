import type { TenantContext } from '@phoenix/shared-kernel';
import { Prisma } from '../../generated/prisma/client';
import { MAX_LOCK_TIMEOUT_MS } from '../unit-of-work/unit-of-work';

/**
 * The only raw SQL the tenant guard lets through: the session statements the UnitOfWork issues
 * at the start of every unit, before `work` runs (ADR-0002, row-level security).
 *
 * - `SET TRANSACTION READ ONLY`, first statement of a read-only unit.
 * - `SELECT pg_catalog.set_config('app.tenant_id', $1, true)`, with the unit's own tenant as
 *   the only parameter: the transaction-local setting that the Postgres policies read through
 *   `platform.current_tenant_id()`. `true` makes it `SET LOCAL`: it ends with the
 *   transaction, so a pooled connection never carries one tenant into the next unit.
 * - `SET LOCAL lock_timeout = '<n>ms'` for the `lockTimeoutMs` option.
 *
 * Module code never reaches raw SQL: the view `PrismaService.tx(tenant)` hands out has no
 * `$queryRaw`, and ESLint and check-prisma-boundaries refuse it outside `platform/persistence/`.
 */

/** The transaction's raw door, held by the UnitOfWork for these statements only. */
export interface RawRunner {
  query(statement: Prisma.Sql): Promise<unknown>;
  execute(statement: Prisma.Sql): Promise<unknown>;
}

/** One raw operation as the client extension hands it over. */
export interface RawStatementRequest {
  readonly operation: string;
  readonly args: unknown;
}

/** The custom setting the policies read. Changing it needs a migration of the helper function. */
export const TENANT_SETTING = 'app.tenant_id';

export function setTenantStatement(tenant: TenantContext): Prisma.Sql {
  return Prisma.sql`SELECT pg_catalog.set_config(${TENANT_SETTING}, ${tenant.tenantId}, true)`;
}

export function readOnlyStatement(): Prisma.Sql {
  return Prisma.raw('SET TRANSACTION READ ONLY');
}

/**
 * `SET LOCAL lock_timeout` for the `lockTimeoutMs` option. The number is checked here as well
 * as at the option, because `SET` takes no parameter and the value is part of the text.
 */
export function lockTimeoutStatement(milliseconds: number): Prisma.Sql {
  if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > MAX_LOCK_TIMEOUT_MS) {
    throw new RangeError('lock timeout out of range');
  }
  return Prisma.raw(`SET LOCAL lock_timeout = '${milliseconds}ms'`);
}

// The texts are taken from the statements themselves, so the check and the issuer cannot drift.
const SET_TENANT_TEXT = Prisma.sql`SELECT pg_catalog.set_config(${TENANT_SETTING}, ${''}, true)`
  .sql;
const READ_ONLY_TEXT = readOnlyStatement().sql;
const LOCK_TIMEOUT_TEXT = /^SET LOCAL lock_timeout = '([1-9][0-9]{0,3})ms'$/u;

/** True when the guard may let this raw operation through for a unit of `tenant`. */
export function isSessionStatement(request: RawStatementRequest, tenant: TenantContext): boolean {
  const { operation, args } = request;
  if (typeof args !== 'object' || args === null) return false;
  const { sql, values } = args as { sql?: unknown; values?: unknown };
  if (typeof sql !== 'string' || !Array.isArray(values)) return false;
  if (operation === '$queryRaw') {
    return (
      sql === SET_TENANT_TEXT &&
      values.length === 2 &&
      values[0] === TENANT_SETTING &&
      values[1] === tenant.tenantId
    );
  }
  if (operation === '$executeRaw') {
    if (sql === READ_ONLY_TEXT) return values.length === 0;
    const match = LOCK_TIMEOUT_TEXT.exec(sql);
    return match !== null && values.length === 0 && Number(match[1]) <= MAX_LOCK_TIMEOUT_MS;
  }
  return false;
}
