// Ported from Mondapac apps/api/src/platform/persistence/audit/audit-transaction.ts, Market adapted to Tenant.
import { isMinted } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { TenantMismatchError, NoUnitOfWorkError } from '../../unit-of-work/errors';
import type { AuditTransaction } from '../guarded-client';
import { unitStorage } from '../unit-store';

/**
 * The audit models of the open unit (Mondapac docs/design/domain/platform-audit.md 2; Hassan M1 on
 * slice 6a), with the same checks as `PrismaService.tx`: it throws `NoUnitOfWorkError` with no
 * open unit and `TenantMismatchError` for another tenant, and every query still
 * passes the tenant guard. Only `platform/persistence/audit/` uses it: `PrismaService.tx`
 * hands module code a view without these models, and `pnpm boundaries` reserves them to this
 * folder.
 */
export function auditTx(tenant: TenantContext): AuditTransaction {
  const unit = unitStorage.getStore();
  if (unit === undefined || unit.closed) throw new NoUnitOfWorkError();
  if (!isMinted(tenant) || tenant.tenantId !== unit.tenant.tenantId) {
    throw new TenantMismatchError();
  }
  return unit.auditView as AuditTransaction;
}
