import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_VIEW } from '../../contracts/permissions';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository, RevisionRecord } from '../definition.repository';
import { REVISION_NOT_FOUND, type RevisionNotFound } from '../failures';

/** One revision with its fields, within the actor's view grants on its definition. */
export class ViewRevision extends UseCase<
  { readonly revisionId: Id<'ObjectRevision'> },
  RevisionRecord,
  RevisionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.view-revision',
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
    input: { readonly revisionId: Id<'ObjectRevision'> },
  ): Promise<Result<RevisionRecord, RevisionNotFound>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.definitions.findRevision(tenant, input.revisionId)),
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return err(REVISION_NOT_FOUND);
    const revision = read.value;
    const definition = await this.reach.definition(
      context,
      OBJECTS_DEFINITIONS_VIEW.key,
      revision.definitionId,
    );
    return definition === null ? err(REVISION_NOT_FOUND) : ok(revision);
  }
}
