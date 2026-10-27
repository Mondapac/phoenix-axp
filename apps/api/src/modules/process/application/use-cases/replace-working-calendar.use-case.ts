import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import { PROCESS_CALENDAR_MANAGE } from '../../contracts/permissions';
import { PROCESS_CALENDAR_CHANGED } from '../../domain/audit-actions';
import { checkWorkingCalendar, type InvalidCalendar } from '../../domain/deadline';
import type { ProcessRepository } from '../process.repository';

export interface ReplaceWorkingCalendarInput {
  /** ISO weekdays not worked, 1 = Monday ... 7 = Sunday; at most six. */
  readonly weekendDays: readonly number[];
  /** ISO dates in the tenant's time zone. */
  readonly holidays: readonly string[];
  /** The version read; 0 for the first calendar of the tenant. */
  readonly version: number;
}

/**
 * Replaces the tenant's working calendar (owner decision D4: the tenant administrator enters
 * it; no default source of holidays). Deadlines already computed keep their due time; tasks
 * seen afterwards count on the new calendar. A stale version is 409 `conflict.stale`.
 */
export class ReplaceWorkingCalendar extends UseCase<
  ReplaceWorkingCalendarInput,
  { version: number },
  InvalidCalendar
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.replace-working-calendar',
    rule: { kind: 'permissions', allOf: [PROCESS_CALENDAR_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: ReplaceWorkingCalendarInput,
  ): Promise<Result<{ version: number }, InvalidCalendar>> {
    const checked = checkWorkingCalendar(input.weekendDays, input.holidays);
    if (!checked.ok) return checked;
    const { tenant } = context;
    return this.unitOfWork.run<{ version: number }, never>(tenant, async () => {
      const saved = await this.repository.saveWorkingCalendar(
        tenant,
        checked.value,
        input.version,
        this.clock.now(),
      );
      if (!saved) throw new StaleAggregateError('WorkingCalendar', tenant.tenantId);
      await this.audit.record(
        context,
        PROCESS_CALENDAR_CHANGED.entry('tenant', {
          after: {
            weekendDays: checked.value.weekendDays.length,
            holidays: checked.value.holidays.length,
          },
        }),
      );
      return ok({ version: input.version + 1 });
    });
  }
}
