import { Injectable } from '@nestjs/common';
import { isMinted } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { NoUnitOfWorkError, TenantMismatchError } from '../unit-of-work/errors';
import { reduceDatabaseError } from './database-error';
import type { TenantTransaction } from './guarded-client';
import { unitStorage } from './unit-store';

export type { TenantTransaction } from './guarded-client';

/**
 * The one door of module code to the database (ported from Mondapac's platform persistence
 * design, "P", 3.3). A repository in `modules/<m>/infrastructure/` calls `tx(tenant)` on every
 * call and never keeps what it returns; it is typed against {@link TenantTransaction}.
 *
 * `tx(tenant)` returns the open unit's model delegates. It throws `NoUnitOfWorkError` when no
 * unit is open (or the unit has ended) and `TenantMismatchError` when `tenant` is not the
 * unit's tenant. Every query it serves still passes the tenant guard (P 4) and, in the
 * database, the row-level security policies (ADR-0002).
 */
@Injectable()
export class PrismaService {
  tx(tenant: TenantContext): TenantTransaction {
    const unit = unitStorage.getStore();
    if (unit === undefined || unit.closed) throw new NoUnitOfWorkError();
    if (!isMinted(tenant) || tenant.tenantId !== unit.tenant.tenantId) {
      throw new TenantMismatchError();
    }
    return unit.view as TenantTransaction;
  }

  /**
   * The constraint an integrity violation (SQLSTATE class 23) named, or null for any other
   * error (P 10, 12.3): a repository maps a known name to its domain error and rethrows
   * everything else. Only the identifier is read; no value, row or message.
   */
  violatedConstraint(error: unknown): string | null {
    const reduced = reduceDatabaseError(error);
    return reduced?.sqlState?.startsWith('23') === true ? (reduced.constraint ?? null) : null;
  }
}
