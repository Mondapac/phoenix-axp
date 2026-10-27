import { setTimeout as sleep } from 'node:timers/promises';
import { isMinted, ok } from '@phoenix/shared-kernel';
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import { Prisma } from '../../generated/prisma/client';
import type { EventDelivery } from '../events/event-delivery';
import {
  InvalidUnitOfWorkOptionsError,
  NestedUnitOfWorkError,
  TransactionConflictError,
  UnmintedTenantContextError,
} from '../unit-of-work/errors';
import {
  CONNECTION_WAIT_MS,
  DEFAULT_UNIT_TIMEOUT_MS,
  MAX_LOCK_TIMEOUT_MS,
  MAX_UNIT_TIMEOUT_MS,
  UNIT_ATTEMPTS,
  type HandledOnce,
  type UnitOfWork,
  type UnitOfWorkOptions,
} from '../unit-of-work/unit-of-work';
import { classifyConflict } from './conflict-classifier';
import {
  auditDelegatesOf,
  modelDelegatesOf,
  type GuardedClient,
  type TenantTransaction,
} from './guarded-client';
import type { ModelMap } from './model-map';
import {
  lockTimeoutStatement,
  readOnlyStatement,
  setTenantStatement,
  type RawRunner,
} from './session-statements';
import {
  issuedDeliveryFor,
  markDelivered,
  recordInInbox,
  settleDelivery,
} from './outbox/delivery-ledger';
import { OpenUnit, unitStorage } from './unit-store';

/** Carries an `err` result out of the transaction callback, so that nothing commits (P 3.1 row 3). */
class RollbackSignal<E> extends Error {
  constructor(readonly result: Result<never, E>) {
    super('The unit returned err; rolled back');
  }
}

/**
 * The transaction's raw door, for the session statements alone. The guard still sees every
 * call and lets through only the statements of `session-statements.ts`.
 */
function rawRunnerOf(transaction: {
  $queryRaw(statement: Prisma.Sql): Promise<unknown>;
  $executeRaw(statement: Prisma.Sql): Promise<unknown>;
}): RawRunner {
  return {
    query: (statement) => transaction.$queryRaw(statement),
    execute: (statement) => transaction.$executeRaw(statement),
  };
}

/** The short random pause between attempts (P 3.1 row 7). */
export type RetryPause = (attempt: number) => Promise<void>;
const randomPause: RetryPause = async () => {
  await sleep(5 + Math.floor(Math.random() * 20));
};

/** Refuses the option combinations of P 3.1 rows 8 and 9. */
export function checkUnitOfWorkOptions(options: UnitOfWorkOptions): void {
  const { readOnly, isolation, timeoutMs, lockTimeoutMs } = options;
  if (readOnly === true && isolation !== undefined) {
    throw new InvalidUnitOfWorkOptionsError('read-only-with-isolation');
  }
  if (readOnly === true && timeoutMs !== undefined) {
    throw new InvalidUnitOfWorkOptionsError('read-only-with-timeout');
  }
  if (readOnly === true && lockTimeoutMs !== undefined) {
    throw new InvalidUnitOfWorkOptionsError('read-only-with-lock-timeout');
  }
  if (
    lockTimeoutMs !== undefined &&
    (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > MAX_LOCK_TIMEOUT_MS)
  ) {
    throw new InvalidUnitOfWorkOptionsError('lock-timeout-out-of-range');
  }
  if (isolation !== undefined && isolation !== 'serializable') {
    throw new InvalidUnitOfWorkOptionsError('unknown-isolation');
  }
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_UNIT_TIMEOUT_MS)
  ) {
    throw new InvalidUnitOfWorkOptionsError('timeout-out-of-range');
  }
}

/**
 * The UnitOfWork (ported from Mondapac's platform persistence design, "P", section 3), on
 * Prisma interactive transactions over the guarded client.
 *
 * Every unit is one interactive transaction per attempt, a fresh {@link OpenUnit} around its
 * client, `work` awaited inside `unitStorage.run` (P 3.2). Its first statements, before
 * `work`, are the session statements: `SET TRANSACTION READ ONLY` for a read-only unit, then
 * `set_config('app.tenant_id', <tenant>, true)` for row-level security (ADR-02), then the
 * optional `SET LOCAL lock_timeout`.
 *
 * - Read-write: READ COMMITTED sends no `isolationLevel`; `serializable` sends `Serializable`.
 *   `40001` and `40P01` are retried, three attempts in all; `55P03` is a conflict at once.
 * - Read-only: one attempt, nothing retried; a conflict code still surfaces as a conflict.
 *   Unlike Mondapac ADR-0025, a read-only unit does open a transaction, because the tenant
 *   setting must be transaction-local.
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly client: GuardedClient,
    private readonly map: ModelMap,
    private readonly pause: RetryPause = randomPause,
    // How long a unit waits to start its transaction; only the database test harness passes it.
    private readonly connectionWaitMs: number = CONNECTION_WAIT_MS,
  ) {}

  async run<T, E>(
    tenant: TenantContext,
    work: () => Promise<Result<T, E>>,
    options: UnitOfWorkOptions = {},
  ): Promise<Result<T, E>> {
    if (!isMinted(tenant)) throw new UnmintedTenantContextError();
    checkUnitOfWorkOptions(options);
    if (unitStorage.getStore() !== undefined) throw new NestedUnitOfWorkError();

    const readOnly = options.readOnly === true;
    const transactionOptions = {
      maxWait: this.connectionWaitMs,
      timeout: options.timeoutMs ?? DEFAULT_UNIT_TIMEOUT_MS,
      ...(options.isolation === 'serializable'
        ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        : {}),
    };
    const attempts = readOnly ? 1 : UNIT_ATTEMPTS;
    for (let attempt = 1; ; attempt += 1) {
      let unit: OpenUnit | undefined;
      try {
        return await this.client.$transaction(async (transaction) => {
          unit = new OpenUnit(
            tenant,
            readOnly,
            modelDelegatesOf(transaction, this.map),
            auditDelegatesOf(transaction, this.map),
          );
          const current = unit;
          const raw = rawRunnerOf(transaction);
          try {
            const result = await unitStorage.run(current, async () => {
              if (readOnly) await raw.execute(readOnlyStatement());
              await raw.query(setTenantStatement(tenant));
              if (options.lockTimeoutMs !== undefined) {
                await raw.execute(lockTimeoutStatement(options.lockTimeoutMs));
              }
              return await work();
            });
            if (!result.ok) throw new RollbackSignal(result);
            return result;
          } finally {
            // Before COMMIT: a query `work` did not await is refused, not committed.
            current.close();
          }
        }, transactionOptions);
      } catch (error) {
        if (error instanceof RollbackSignal) return error.result;
        const conflict = classifyConflict(error);
        if (conflict === null) throw error;
        if (!conflict.retry || attempt >= attempts) {
          throw new TransactionConflictError(conflict.sqlState);
        }
        await this.pause(attempt);
      } finally {
        unit?.close();
      }
    }
  }

  /**
   * Ported from Mondapac (P 6.4; ADR-05): the inbox row, the work when the row is new, and the
   * mark of the delivery, in one read-write unit of the delivery's tenant; on a retry of the
   * unit all three run again. The delivery is settled only after the commit, so the dispatcher
   * sees a failed handler.
   */
  async runOnce<T, E>(
    tenant: TenantContext,
    delivery: EventDelivery,
    work: () => Promise<Result<T, E>>,
    options: Omit<UnitOfWorkOptions, 'readOnly'> = {},
  ): Promise<Result<HandledOnce<T>, E>> {
    if ((options as UnitOfWorkOptions).readOnly === true) {
      throw new InvalidUnitOfWorkOptionsError('read-only-run-once');
    }
    if (!isMinted(tenant)) throw new UnmintedTenantContextError();
    const record = issuedDeliveryFor(delivery, tenant);
    const result = await this.run(
      tenant,
      async (): Promise<Result<HandledOnce<T>, E>> => {
        const view = unitStorage.getStore()!.view as TenantTransaction;
        let outcome: HandledOnce<T> = { handled: false };
        if (await recordInInbox(view, this.map, delivery, record)) {
          const done = await work();
          if (!done.ok) return done;
          outcome = { handled: true, value: done.value };
        }
        await markDelivered(view, delivery, record);
        return ok(outcome);
      },
      options,
    );
    if (result.ok) settleDelivery(delivery);
    return result;
  }
}
