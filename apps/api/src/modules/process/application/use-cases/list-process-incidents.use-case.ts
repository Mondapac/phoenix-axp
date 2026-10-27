import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_INCIDENTS_VIEW } from '../../contracts/permissions';
import type { IncidentRecord, ProcessRepository } from '../process.repository';

export interface ListProcessIncidentsInput {
  /** 1 to {@link MAX_INCIDENTS}. */
  readonly limit: number;
}

export const MAX_INCIDENTS = 100;

/** The bridge's latest incidents, newest first, for operators (PoC 3 R3, R10). */
export class ListProcessIncidents extends UseCase<ListProcessIncidentsInput, IncidentRecord[]> {
  static override readonly access: AccessDeclaration = {
    name: 'process.list-process-incidents',
    rule: { kind: 'permissions', allOf: [PROCESS_INCIDENTS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: ListProcessIncidentsInput,
  ): Promise<Result<IncidentRecord[], never>> {
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), MAX_INCIDENTS);
    return this.unitOfWork.run<IncidentRecord[], never>(
      context.tenant,
      async () => ok(await this.repository.latestIncidents(context.tenant, limit)),
      { readOnly: true },
    );
  }
}
