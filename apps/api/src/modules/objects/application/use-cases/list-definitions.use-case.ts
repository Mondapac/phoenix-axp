import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_VIEW } from '../../contracts/permissions';
import type { DefinitionStatus } from '../../domain/lifecycle';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRecord, DefinitionRepository } from '../definition.repository';

export interface ListDefinitionsInput {
  readonly siteId: Id<'Site'> | null;
  readonly status: DefinitionStatus | null;
}

/** The definitions whose site the actor's view grants reach, by name. */
export class ListDefinitions extends UseCase<ListDefinitionsInput, DefinitionRecord[], never> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.list-definitions',
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
    input: ListDefinitionsInput,
  ): Promise<Result<DefinitionRecord[], never>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.definitions.list(tenant, input)),
      { readOnly: true },
    );
    if (!read.ok) return ok([]);
    return ok(await this.reach.filter(context, OBJECTS_DEFINITIONS_VIEW.key, read.value));
  }
}
