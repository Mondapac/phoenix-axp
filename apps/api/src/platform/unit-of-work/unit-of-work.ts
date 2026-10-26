import type { Result, TenantContext } from '@phoenix/shared-kernel';

/**
 * Options of one unit (ported from Mondapac's platform persistence design, "P", 3.1).
 * Defaults: read-write, READ COMMITTED (the database default; nothing is sent for it), 5000 ms.
 *
 * Every unit, the read-only one included, is one transaction whose first statement sets
 * `app.tenant_id` for Postgres row-level security (ADR-02). This departs from Mondapac
 * Mondapac ADR-0025, where a read-only unit opened no transaction: a transaction-local setting needs
 * a transaction, and a session-level one could leak to the next borrower of the connection.
 */
export interface UnitOfWorkOptions {
  /**
   * A `READ ONLY` transaction: `work` runs once (no retry) on the guarded client, which
   * refuses every write, and the database refuses one too. Refused together with
   * `isolation`, `timeoutMs` or `lockTimeoutMs`.
   */
  readonly readOnly?: boolean;
  /** For invariants that span rows (P 3.1 row 6). */
  readonly isolation?: 'serializable';
  /** The read-write unit's timeout, at most {@link MAX_UNIT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /**
   * How long a statement of this unit may wait for a row lock, at most
   * {@link MAX_LOCK_TIMEOUT_MS}. Issued by the persistence layer
   * as `SET LOCAL lock_timeout`, the first statement of every attempt; a wait that runs out
   * ends the unit with `TransactionConflictError` (55P03). Absent: the login role's own
   * `lock_timeout` (`scripts/db/bootstrap-dev.sql`). Refused for a read-only unit.
   */
  readonly lockTimeoutMs?: number;
}

/**
 * The transaction boundary of a use case (P 3; Mondapac ADR-0004 decision 5 as amended by
 * Mondapac ADR-0023). The use-case body calls `run` itself, after its authorisation and its slow work
 * (P 3.4, T1 option A); at most one read-write unit per use case.
 *
 * - `ok` commits; `err` commits nothing and is returned unchanged; an exception commits
 *   nothing and is rethrown (P 3.1 row 3).
 * - `run` inside an open unit throws `NestedUnitOfWorkError` (row 4).
 * - `work` may run up to three times on a serialisation failure or deadlock (row 7): it
 *   reloads what it changes and does nothing external (no hashing, HTTP, mail, facade or model
 *   call; row 5).
 */
export interface UnitOfWork {
  run<T, E>(
    tenant: TenantContext,
    work: () => Promise<Result<T, E>>,
    options?: UnitOfWorkOptions,
  ): Promise<Result<T, E>>;
}

/** Nest injection token of the {@link UnitOfWork} port. */
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

/** Prisma's default interactive-transaction timeout, the default of a read-write unit (P 3.1 row 8). */
export const DEFAULT_UNIT_TIMEOUT_MS = 5000;
/** The most a unit may ask for with `timeoutMs` (P 3.1 row 8). */
export const MAX_UNIT_TIMEOUT_MS = 30_000;
/**
 * The most a unit may ask for with `lockTimeoutMs`: the role-level `lock_timeout` is at most 3 s
 * (start-up check `role_timeouts`). A unit that asks for more than a role set lower gets
 * the larger value, never above this ceiling.
 */
export const MAX_LOCK_TIMEOUT_MS = 3000;
/** The longest wait for a pooled connection, in a transaction and for every statement (row 8). */
export const CONNECTION_WAIT_MS = 2000;
/** Attempts of a read-write unit on `40001` or `40P01` (row 7). */
export const UNIT_ATTEMPTS = 3;
