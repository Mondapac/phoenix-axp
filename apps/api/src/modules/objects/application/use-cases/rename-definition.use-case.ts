import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_DESIGN } from '../../contracts/permissions';
import { DEFINITION_RENAMED } from '../../domain/audit-actions';
import { parseName } from '../../domain/values';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository } from '../definition.repository';
import { DEFINITION_NOT_FOUND, type DefinitionNotFound, type InvalidValue } from '../failures';

export interface RenameDefinitionInput {
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly version: number;
  readonly name: string;
}

/** Changes a definition's display name; its key (the API path) never changes. */
export class RenameDefinition extends UseCase<
  RenameDefinitionInput,
  void,
  InvalidValue | DefinitionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.rename-definition',
    rule: { kind: 'permissions', allOf: [OBJECTS_DEFINITIONS_DESIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly reach: DefinitionReach,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: RenameDefinitionInput,
  ): Promise<Result<void, InvalidValue | DefinitionNotFound>> {
    const name = parseName(input.name);
    if (!name.ok) return name;
    const found = await this.reach.definition(
      context,
      OBJECTS_DEFINITIONS_DESIGN.key,
      input.definitionId,
    );
    if (found === null) return err(DEFINITION_NOT_FOUND);
    const { tenant } = context;
    return this.unitOfWork.run<void, InvalidValue | DefinitionNotFound>(tenant, async () => {
      await this.definitions.saveState(
        tenant,
        found.id,
        input.version,
        { name: name.value },
        this.clock.now(),
      );
      await this.audit.record(context, DEFINITION_RENAMED.entry(found.id, {}));
      return ok(undefined);
    });
  }
}
