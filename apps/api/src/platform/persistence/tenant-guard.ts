import type { TenantContext } from '@phoenix/shared-kernel';
import { TenantGuardError, type TenantGuardRefusal } from '../unit-of-work/errors';
import type { ModelMap, ModelMapEntry } from './model-map';
import { isSessionStatement } from './session-statements';

/**
 * The `tenant_id` guard (ported from Mondapac's platform persistence design, "P", section 4).
 * Every query of the guarded client passes through {@link tenantGuardRefusal}, a pure function
 * of (map entry, operation, arguments, open unit). It decides from allow-lists: whatever it
 * does not recognise is refused, and a refusal throws {@link TenantGuardError}, so the unit
 * rolls back.
 *
 * It is the application's half of tenant isolation (ADR-0002). The database's half is row-level
 * security: every unit sets `app.tenant_id` and the policies compare each row's `tenant_id`
 * to it, so a query that slipped past the guard still sees only the unit's tenant.
 */

/** What the guard reads of the open unit (P 3.2). */
export interface GuardUnit {
  readonly tenant: TenantContext;
  readonly readOnly: boolean;
  readonly closed: boolean;
}

/** One query as the client extension hands it over. */
export interface GuardRequest {
  /** The model name; undefined for a client-level operation such as `$queryRaw`. */
  readonly model: string | undefined;
  readonly operation: string;
  readonly args: unknown;
}

const READ_OPERATION_NAMES = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
] as const;
const WHERE_WRITE_OPERATION_NAMES = [
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
] as const;
const CREATE_OPERATION_NAMES = ['create', 'createMany', 'createManyAndReturn'] as const;

const READ_OPERATIONS = new Set<string>(READ_OPERATION_NAMES);
const WHERE_WRITE_OPERATIONS = new Set<string>(WHERE_WRITE_OPERATION_NAMES);
const CREATE_OPERATIONS = new Set<string>(CREATE_OPERATION_NAMES);

/**
 * Every model operation the guard lets through on some arguments, and so every operation a
 * repository may call: each delegate of the view `PrismaService.tx(tenant)` hands out holds
 * these functions and nothing else.
 */
export const GUARDED_OPERATIONS = Object.freeze([
  ...READ_OPERATION_NAMES,
  ...WHERE_WRITE_OPERATION_NAMES,
  ...CREATE_OPERATION_NAMES,
  'upsert',
] as const);
export type GuardedOperation = (typeof GUARDED_OPERATIONS)[number];
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);
/** The two raw operations a session statement (session-statements.ts) may use; no `Unsafe` form. */
const SESSION_STATEMENT_OPERATIONS = new Set(['$queryRaw', '$executeRaw']);
const RAW_OPERATIONS = new Set([
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
  '$queryRawTyped',
]);
const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT']);

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

const has = (object: Plain, key: string): boolean => Object.hasOwn(object, key);

/** The top-level `tenantId` of a where: the unit's tenant, as a plain value or `{ equals }`. */
function whereTenantRefusal(where: Plain, tenantId: string): TenantGuardRefusal | null {
  if (!has(where, 'tenantId')) return 'where-tenant-missing';
  const value = where.tenantId;
  if (typeof value === 'string') return value === tenantId ? null : 'where-tenant-mismatch';
  if (isPlainObject(value) && Object.keys(value).length === 1 && has(value, 'equals')) {
    return value.equals === tenantId ? null : 'where-tenant-mismatch';
  }
  // `mode`, `in`, `not`, null, an array or any other shape does not name one tenant.
  return 'where-tenant-mismatch';
}

/** P 4.1 rows 1 to 3: the keys of a where, its top-level tenant and its compound selectors. */
function whereRefusal(
  entry: ModelMapEntry,
  args: Plain,
  unit: GuardUnit,
): TenantGuardRefusal | null {
  const where = args.where;
  // An exempt model needs no tenant, so it may read without a where.
  if (where === undefined && entry.scope === 'exempt') return null;
  if (!isPlainObject(where)) return 'where-missing';
  const selectors = new Map(entry.compoundSelectors.map((s) => [s.name, s]));
  for (const key of Object.keys(where)) {
    const known =
      LOGICAL_KEYS.has(key) ||
      entry.scalarFields.includes(key) ||
      entry.relationFields.includes(key) ||
      selectors.has(key);
    if (!known) return 'where-unknown-key';
  }
  if (entry.scope !== 'scoped') return null;

  const tenant = whereTenantRefusal(where, unit.tenant.tenantId);
  if (tenant !== null) return tenant;

  // Every compound selector named in the where that contains tenantId names exactly the
  // unit's tenant as a plain value.
  for (const [name, selector] of selectors) {
    if (!has(where, name)) continue;
    const value = where[name];
    if (!isPlainObject(value)) return 'selector-malformed';
    if (selector.fields.includes('tenantId') && value.tenantId !== unit.tenant.tenantId) {
      return 'selector-tenant-mismatch';
    }
  }
  return null;
}

const CURSOR_REFUSALS: Partial<Record<TenantGuardRefusal, TenantGuardRefusal>> = {
  'where-missing': 'cursor-malformed',
  'where-unknown-key': 'cursor-unknown-key',
  'where-tenant-missing': 'cursor-tenant-missing',
  'where-tenant-mismatch': 'cursor-tenant-mismatch',
};

/**
 * The `cursor` of a scoped model's read is a unique where of its own: it names the unit's
 * tenant at the top level, and its compound selectors are read as a where's are.
 * A cursor on an exempt model is let through.
 */
function cursorRefusal(
  entry: ModelMapEntry,
  args: Plain,
  unit: GuardUnit,
): TenantGuardRefusal | null {
  if (args.cursor === undefined || entry.scope !== 'scoped') return null;
  const refusal = whereRefusal(entry, { where: args.cursor }, unit);
  return refusal === null ? null : (CURSOR_REFUSALS[refusal] ?? refusal);
}

/** A relation field among the keys of a write's data (P 4.1 row 8). */
const nestedWrite = (entry: ModelMapEntry, data: Plain): boolean =>
  Object.keys(data).some((key) => entry.relationFields.includes(key));

/** One created row: the unit's tenant, no nested write (P 4.1 row 4). */
function createRowRefusal(
  entry: ModelMapEntry,
  data: unknown,
  unit: GuardUnit,
): TenantGuardRefusal | null {
  if (!isPlainObject(data)) return 'data-missing';
  if (entry.scope === 'scoped' && data.tenantId !== unit.tenant.tenantId) {
    return 'data-tenant-mismatch';
  }
  return nestedWrite(entry, data) ? 'nested-write' : null;
}

/** The data of an update: never the tenant, no nested write (P 4.1 rows 7 and 8). */
function updateDataRefusal(entry: ModelMapEntry, data: unknown): TenantGuardRefusal | null {
  if (!isPlainObject(data)) return 'data-missing';
  if (entry.scope === 'scoped' && has(data, 'tenantId')) return 'data-changes-tenant';
  return nestedWrite(entry, data) ? 'nested-write' : null;
}

/**
 * Why the guard refuses a query, or null when it lets it through. Pure: no database, no
 * Nest, no store lookup (the caller passes the open unit, or undefined when there is none).
 */
export function tenantGuardRefusal(
  map: ModelMap,
  request: GuardRequest,
  unit: GuardUnit | undefined,
): TenantGuardRefusal | null {
  const { model, operation } = request;
  if (RAW_OPERATIONS.has(operation)) {
    // The one exemption: the exact text of a session statement, with the open unit's tenant
    // as its parameter, in a unit that is still open. Anything else is refused.
    const session =
      SESSION_STATEMENT_OPERATIONS.has(operation) &&
      unit !== undefined &&
      !unit.closed &&
      isSessionStatement(request, unit.tenant);
    return session ? null : 'raw-sql';
  }
  if (model === undefined) return 'unknown-operation';
  if (unit === undefined) return 'no-open-unit';
  if (unit.closed) return 'unit-closed';
  const entry = Object.hasOwn(map.models, model) ? map.models[model] : undefined;
  if (entry === undefined || entry.scope === 'invalid') return 'unknown-model';

  const isRead = READ_OPERATIONS.has(operation);
  const isWhereWrite = WHERE_WRITE_OPERATIONS.has(operation);
  const isCreate = CREATE_OPERATIONS.has(operation);
  const isUpsert = operation === 'upsert';
  if (!isRead && !isWhereWrite && !isCreate && !isUpsert) return 'unknown-operation';
  if (unit.readOnly && !isRead) return 'write-in-read-only-unit';

  const args: Plain = isPlainObject(request.args) ? request.args : {};

  if (isCreate) {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    if (rows.length === 0) return 'data-missing';
    for (const data of rows) {
      const refusal = createRowRefusal(entry, data, unit);
      if (refusal !== null) return refusal;
    }
    return null;
  }

  const where = whereRefusal(entry, args, unit) ?? cursorRefusal(entry, args, unit);
  if (where !== null) return where;

  if (isUpsert) {
    const whereObject = args.where as Plain;
    if (entry.idField !== null && has(whereObject, entry.idField)) return 'upsert-by-id';
    if (entry.scope === 'scoped') {
      const bySelector = entry.compoundSelectors.some(
        (selector) => selector.fields.includes('tenantId') && has(whereObject, selector.name),
      );
      if (!bySelector) return 'upsert-without-tenant-selector';
    }
    return createRowRefusal(entry, args.create, unit) ?? updateDataRefusal(entry, args.update);
  }
  if (UPDATE_OPERATIONS.has(operation)) return updateDataRefusal(entry, args.data);
  return null;
}

/** Reads the open unit; injected so that the guard does not import the store's module. */
export type OpenUnitLookup = () => GuardUnit | undefined;

interface QueryHookParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/**
 * The guard as a Prisma client extension (P 4.2): one `query.$allOperations` hook, which
 * receives model operations and the client-level raw operations alike, on the base client
 * and on its interactive-transaction clients.
 */
export function tenantGuardExtension(map: ModelMap, openUnit: OpenUnitLookup) {
  return {
    name: 'tenant-guard',
    query: {
      async $allOperations({ model, operation, args, query }: QueryHookParams): Promise<unknown> {
        const refusal = tenantGuardRefusal(map, { model, operation, args }, openUnit());
        if (refusal !== null) throw new TenantGuardError(refusal, model ?? null, operation);
        return query(args);
      },
    },
  };
}
