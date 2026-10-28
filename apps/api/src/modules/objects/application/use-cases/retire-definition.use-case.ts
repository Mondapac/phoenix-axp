import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_PUBLISH } from '../../contracts/permissions';
import { DEFINITION_RETIRED } from '../../domain/audit-actions';
import { planRetire } from '../../domain/lifecycle';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository } from '../definition.repository';
import { DEFINITION_NOT_FOUND, type DefinitionNotFound, type NotPublished } from '../failures';

export interface RetireDefinitionInput {
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly version: number;
}

/** Stops new records and changes; existing records can still be read and deleted. */
export class RetireDefinition extends UseCase<
  RetireDefinitionInput,
  void,
  DefinitionNotFound | NotPublished
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.retire-definition',
    rule: { kind: 'permissions', allOf: [OBJECTS_DEFINITIONS_PUBLISH.key] },
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
    input: RetireDefinitionInput,
  ): Promise<Result<void, DefinitionNotFound | NotPublished>> {
    const reached = await this.reach.definition(
      context,
      OBJECTS_DEFINITIONS_PUBLISH.key,
      input.definitionId,
    );
    if (reached === null) return err(DEFINITION_NOT_FOUND);
    const { tenant } = context;
    return this.unitOfWork.run<void, DefinitionNotFound | NotPublished>(tenant, async () => {
      const definition = await this.definitions.find(tenant, input.definitionId);
      if (definition === null) return err(DEFINITION_NOT_FOUND);
      const next = planRetire(definition);
      if (!next.ok) return next;
      await this.definitions.saveState(
        tenant,
        definition.id,
        input.version,
        next.value,
        this.clock.now(),
      );
      await this.audit.record(
        context,
        DEFINITION_RETIRED.entry(definition.id, {
          before: { revisionId: definition.publishedRevisionId! },
        }),
      );
      return ok(undefined);
    });
  }
}
