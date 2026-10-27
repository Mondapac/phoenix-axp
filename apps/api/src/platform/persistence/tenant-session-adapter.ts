import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * SPIKE (PoC 1, design change candidate): set the unit's tenant in the driver adapter, right
 * after BEGIN, instead of through Prisma's raw-query path.
 *
 * PoC 1 measured that the fixed cost of the row-level-security unit is not the policies (the
 * planner folds `tenant_id = current_tenant_id()` into a one-time filter) but the extra
 * statements Prisma runs inside an interactive transaction: `SET TRANSACTION READ ONLY` and
 * `set_config(...)` each cost a full trip through the query engine. Here the UnitOfWork names
 * the pending unit in an AsyncLocalStorage before it calls `$transaction`; the adapter sends
 * one statement on the transaction's own connection, right after its BEGIN:
 *
 *   SELECT pg_catalog.set_config('app.tenant_id', $1, true)
 *        [, pg_catalog.set_config('transaction_read_only', 'on', true)]
 *
 * Still transaction-local (`true`), still parameterised; the guard no longer needs a raw-SQL
 * exemption for session statements. A transaction started without a pending unit gets no
 * tenant, so row-level security shows it nothing (fail closed).
 */

export interface PendingSession {
  readonly tenantId: string;
  readonly readOnly: boolean;
}

/** Set by the UnitOfWork around `$transaction`; read by the adapter in startTransaction. */
export const pendingSession = new AsyncLocalStorage<PendingSession>();

const SET_TENANT = "SELECT pg_catalog.set_config('app.tenant_id', $1, true)";
const SET_TENANT_READ_ONLY =
  "SELECT pg_catalog.set_config('app.tenant_id', $1, true), " +
  "pg_catalog.set_config('transaction_read_only', 'on', true)";

interface PgTransactionLike {
  readonly client: { query(text: string, values: unknown[]): Promise<unknown> };
  rollback(): Promise<void>;
}

interface AdapterLike {
  startTransaction(isolationLevel?: unknown): Promise<unknown>;
}

interface AdapterFactoryLike {
  readonly provider: string;
  readonly adapterName: string;
  connect(): Promise<unknown>;
}

/** Wraps a PrismaPg adapter factory so every transaction starts with the pending unit's tenant. */
export function withTenantSession<F extends AdapterFactoryLike>(factory: F): F {
  const connect = async (): Promise<unknown> => {
    const adapter = (await factory.connect()) as AdapterLike;
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel?: unknown) => {
      const session = pendingSession.getStore();
      const transaction = (await start(isolationLevel)) as PgTransactionLike;
      if (session === undefined) return transaction;
      try {
        await transaction.client.query(session.readOnly ? SET_TENANT_READ_ONLY : SET_TENANT, [
          session.tenantId,
        ]);
      } catch (error) {
        await transaction.client.query('ROLLBACK', []).catch(() => undefined);
        await transaction.rollback();
        throw error;
      }
      return transaction;
    };
    return adapter;
  };
  return Object.assign(Object.create(Object.getPrototypeOf(factory) as object) as F, factory, {
    connect,
  });
}
