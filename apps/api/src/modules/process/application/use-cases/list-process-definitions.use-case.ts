import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_DEFINITIONS_DESIGN } from '../../contracts/permissions';
import type { DefinitionSummary, ProcessRepository } from '../process.repository';

/** The most process keys one list answers. */
export const MAX_DEFINITIONS = 500;

/** The tenant's process keys for the modeler: each one's draft and latest published revision. */
export class ListProcessDefinitions extends UseCase<
  void,
  { items: DefinitionSummary[]; truncated: boolean }
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.list-process-definitions',
    rule: { kind: 'permissions', allOf: [PROCESS_DEFINITIONS_DESIGN.key] },
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
  ): Promise<Result<{ items: DefinitionSummary[]; truncated: boolean }, never>> {
    return this.unitOfWork.run(
      context.tenant,
      async () => {
        const items = await this.repository.listDefinitions(context.tenant, MAX_DEFINITIONS + 1);
        return ok({
          items: items.slice(0, MAX_DEFINITIONS),
          truncated: items.length > MAX_DEFINITIONS,
        });
      },
      { readOnly: true },
    );
  }
}
