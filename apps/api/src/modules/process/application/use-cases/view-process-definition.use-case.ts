import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_DEFINITIONS_DESIGN } from '../../contracts/permissions';
import { DEFINITION_NOT_FOUND, type DefinitionNotFound } from '../failures';
import type { DraftRecord, LatestRevision, ProcessRepository } from '../process.repository';

export interface ProcessDefinition {
  readonly processKey: string;
  readonly draft: DraftRecord | null;
  readonly published: LatestRevision | null;
}

/** One process key in the modeler: its draft and its latest published revision, with models. */
export class ViewProcessDefinition extends UseCase<
  { readonly processKey: string },
  ProcessDefinition,
  DefinitionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.view-process-definition',
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
    input: { readonly processKey: string },
  ): Promise<Result<ProcessDefinition, DefinitionNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<ProcessDefinition, DefinitionNotFound>(
      tenant,
      async () => {
        const draft = await this.repository.findDraft(tenant, input.processKey);
        const published = await this.repository.latestRevision(tenant, input.processKey);
        if (draft === null && published === null) return err(DEFINITION_NOT_FOUND);
        return ok({ processKey: input.processKey, draft, published });
      },
      { readOnly: true },
    );
  }
}
