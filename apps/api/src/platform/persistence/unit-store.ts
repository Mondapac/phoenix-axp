import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '@phoenix/shared-kernel';
import type { GuardUnit } from './tenant-guard';

/**
 * The open unit (ported from Mondapac's platform persistence design, "P", 3.2): the one value
 * the persistence layer's `AsyncLocalStorage` carries. The tenant the unit was opened with,
 * the read-only flag, the model-delegate view `tx(tenant)` hands out (the transaction
 * client's), and a `closed` flag that `run` sets when the unit ends. No actor, no correlation
 * id, no accessor for modules: only `platform/persistence/` reads it.
 */
export class OpenUnit implements GuardUnit {
  #closed = false;

  constructor(
    readonly tenant: TenantContext,
    readonly readOnly: boolean,
    readonly view: object,
    /**
     * The audit models of the same transaction client (ported from Mondapac): read only by
     * `auditTx` in `platform/persistence/audit/`; `PrismaService.tx` hands out `view`, which
     * lacks them.
     */
    readonly auditView: object,
  ) {
    Object.freeze(this);
  }

  /** Set once by `run`; a query that meets a closed unit is refused. */
  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    this.#closed = true;
  }
}

/** The single store of open units. Not exported from the persistence module. */
export const unitStorage = new AsyncLocalStorage<OpenUnit>();
