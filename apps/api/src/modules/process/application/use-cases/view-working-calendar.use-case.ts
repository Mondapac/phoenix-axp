import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_CALENDAR_MANAGE } from '../../contracts/permissions';
import type { CalendarRecord, ProcessRepository } from '../process.repository';

/** The tenant's working calendar (owner decision D4); version 0 while none was entered. */
export class ViewWorkingCalendar extends UseCase<void, CalendarRecord> {
  static override readonly access: AccessDeclaration = {
    name: 'process.view-working-calendar',
    rule: { kind: 'permissions', allOf: [PROCESS_CALENDAR_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<CalendarRecord, never>> {
    return this.unitOfWork.run<CalendarRecord, never>(
      context.tenant,
      async () => ok(await this.repository.readWorkingCalendar(context.tenant)),
      { readOnly: true },
    );
  }
}
