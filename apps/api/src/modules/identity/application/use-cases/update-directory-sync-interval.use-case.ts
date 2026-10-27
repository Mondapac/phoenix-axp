import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ACCOUNTS_MANAGE } from '../../contracts/permissions';
import { DIRECTORY_SYNC_INTERVAL_CHANGED } from '../../domain/audit-actions';
import { parseSyncInterval, type InvalidInterval } from '../../domain/directory-sync';
import type { DirectorySyncRepository } from '../directory-sync.repository';

export interface UpdateDirectorySyncIntervalInput {
  readonly version: number;
  readonly intervalMinutes: number;
}

/**
 * Sets how often the tenant's directory sync runs: 1 to 60 minutes (ADR-0022 decision 6). It is
 * also the longest delay between a disable in AD and the next refused request.
 */
export class UpdateDirectorySyncInterval extends UseCase<
  UpdateDirectorySyncIntervalInput,
  void,
  InvalidInterval
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.update-directory-sync-interval',
    rule: { kind: 'permissions', allOf: [IDENTITY_ACCOUNTS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly syncs: DirectorySyncRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: UpdateDirectorySyncIntervalInput,
  ): Promise<Result<void, InvalidInterval>> {
    const interval = parseSyncInterval(input.intervalMinutes);
    if (!interval.ok) return Promise.resolve(interval);
    const { tenant } = context;
    return this.unitOfWork.run<void, InvalidInterval>(tenant, async () => {
      const state = await this.syncs.read(tenant);
      if (state.version !== input.version) {
        throw new StaleAggregateError('identity.directory-sync', tenant.tenantId);
      }
      if (state.intervalMinutes === interval.value) return ok(undefined);
      await this.syncs.saveInterval(tenant, state.version, interval.value, this.clock.now());
      await this.audit.record(
        context,
        DIRECTORY_SYNC_INTERVAL_CHANGED.entry('tenant', {
          before: { intervalMinutes: state.intervalMinutes },
          after: { intervalMinutes: interval.value },
        }),
      );
      return ok(undefined);
    });
  }
}
