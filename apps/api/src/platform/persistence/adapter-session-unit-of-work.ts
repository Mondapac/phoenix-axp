import type { Result, TenantContext } from '@phoenix/shared-kernel';
import { isMinted } from '@phoenix/shared-kernel';
import { MODEL_MAP } from '../../generated/model-map';
import { NestedUnitOfWorkError, UnmintedTenantContextError } from '../unit-of-work/errors';
import {
  CONNECTION_WAIT_MS,
  DEFAULT_UNIT_TIMEOUT_MS,
  type UnitOfWork,
  type UnitOfWorkOptions,
} from '../unit-of-work/unit-of-work';
import { modelDelegatesOf, type GuardedClient } from './guarded-client';
import { pendingSession } from './tenant-session-adapter';
import { OpenUnit, unitStorage } from './unit-store';

class Rollback<E> extends Error {
  constructor(readonly result: Result<never, E>) {
    super('The unit returned err; rolled back');
  }
}

/**
 * SPIKE (PoC 1, design change candidate): the UnitOfWork with its session statements moved into
 * the driver adapter (tenant-session-adapter.ts). It names the pending unit, then opens the
 * transaction; the adapter sets `app.tenant_id` (and READ ONLY) right after BEGIN, on the
 * transaction's connection, in one statement. The rest is PrismaUnitOfWork's contract, minus
 * the retries and lock timeout, which a Phase 1 version keeps unchanged.
 */
export class AdapterSessionUnitOfWork implements UnitOfWork {
  constructor(
    private readonly client: GuardedClient,
    private readonly connectionWaitMs: number = CONNECTION_WAIT_MS,
  ) {}

  async run<T, E>(
    tenant: TenantContext,
    work: () => Promise<Result<T, E>>,
    options: UnitOfWorkOptions = {},
  ): Promise<Result<T, E>> {
    if (!isMinted(tenant)) throw new UnmintedTenantContextError();
    if (unitStorage.getStore() !== undefined) throw new NestedUnitOfWorkError();
    const readOnly = options.readOnly === true;
    try {
      return await pendingSession.run({ tenantId: tenant.tenantId, readOnly }, () =>
        this.client.$transaction(
          async (transaction) => {
            const unit = new OpenUnit(tenant, readOnly, modelDelegatesOf(transaction, MODEL_MAP));
            try {
              const result = await unitStorage.run(unit, work);
              if (!result.ok) throw new Rollback(result);
              return result;
            } finally {
              unit.close();
            }
          },
          { maxWait: this.connectionWaitMs, timeout: options.timeoutMs ?? DEFAULT_UNIT_TIMEOUT_MS },
        ),
      );
    } catch (error) {
      if (error instanceof Rollback) return error.result;
      throw error;
    }
  }
}
