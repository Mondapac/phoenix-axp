import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_DEFINITIONS_PUBLISH } from '../../contracts/permissions';
import { DEFINITION_PUBLISHED } from '../../domain/audit-actions';
import { planPublish } from '../../domain/lifecycle';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  REVISION_NOT_FOUND,
  type AlreadyPublished,
  type DefinitionNotFound,
  type RevisionNotFound,
} from '../failures';

export interface PublishDefinitionInput {
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly version: number;
  readonly revisionId: Id<'ObjectRevision'>;
}

export type PublishDefinitionFailure = DefinitionNotFound | RevisionNotFound | AlreadyPublished;

/**
 * Points the definition at one of its revisions: new records and every later change of a
 * record are written under it (a record keeps the revision it was last written under, V3).
 */
export class PublishDefinition extends UseCase<
  PublishDefinitionInput,
  void,
  PublishDefinitionFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.publish-definition',
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
    input: PublishDefinitionInput,
  ): Promise<Result<void, PublishDefinitionFailure>> {
    const reached = await this.reach.definition(
      context,
      OBJECTS_DEFINITIONS_PUBLISH.key,
      input.definitionId,
    );
    if (reached === null) return err(DEFINITION_NOT_FOUND);
    const { tenant } = context;
    return this.unitOfWork.run<void, PublishDefinitionFailure>(tenant, async () => {
      const definition = await this.definitions.find(tenant, input.definitionId);
      if (definition === null) return err(DEFINITION_NOT_FOUND);
      const revision = await this.definitions.findRevision(tenant, input.revisionId);
      // Another definition's revision answers as one that does not exist.
      if (revision === null || revision.definitionId !== definition.id) {
        return err(REVISION_NOT_FOUND);
      }
      const next = planPublish(definition, revision.id);
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
        DEFINITION_PUBLISHED.entry(definition.id, {
          before: { status: definition.status, revisionId: definition.publishedRevisionId },
          after: { revisionId: revision.id, number: revision.number },
        }),
      );
      return ok(undefined);
    });
  }
}
