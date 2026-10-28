import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_VIEW } from '../../contracts/permissions';
import type { DefinitionReach } from '../definition-reach';
import type {
  DefinitionRecord,
  DefinitionRepository,
  RevisionSummary,
} from '../definition.repository';
import { DEFINITION_NOT_FOUND, type DefinitionNotFound } from '../failures';

export interface DefinitionDetail {
  readonly definition: DefinitionRecord;
  /** Newest first. */
  readonly revisions: readonly RevisionSummary[];
}

/** One definition and its revisions, within the actor's view grants. */
export class ViewDefinition extends UseCase<
  { readonly definitionId: Id<'ObjectDefinition'> },
  DefinitionDetail,
  DefinitionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.view-definition',
    rule: { kind: 'permissions', allOf: [OBJECTS_DEFINITIONS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly reach: DefinitionReach,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { readonly definitionId: Id<'ObjectDefinition'> },
  ): Promise<Result<DefinitionDetail, DefinitionNotFound>> {
    const definition = await this.reach.definition(
      context,
      OBJECTS_DEFINITIONS_VIEW.key,
      input.definitionId,
    );
    if (definition === null) return err(DEFINITION_NOT_FOUND);
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.definitions.listRevisions(tenant, definition.id)),
      { readOnly: true },
    );
    return read.ok ? ok({ definition, revisions: read.value }) : err(DEFINITION_NOT_FOUND);
  }
}
