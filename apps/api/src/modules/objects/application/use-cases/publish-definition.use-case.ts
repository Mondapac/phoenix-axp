import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import {
  OBJECTS_DEFINITIONS_LOWER_SENSITIVITY,
  OBJECTS_DEFINITIONS_PUBLISH,
} from '../../contracts/permissions';
import { DEFINITION_PUBLISHED, REVISION_SENSITIVITY_LOWERED } from '../../domain/audit-actions';
import { planPublish } from '../../domain/lifecycle';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository, RevisionRecord } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  REVISION_NOT_FOUND,
  type AlreadyPublished,
  type DefinitionNotFound,
  type LoweringDenied,
  type RevisionNotFound,
} from '../failures';

export interface PublishDefinitionInput {
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly version: number;
  readonly revisionId: Id<'ObjectRevision'>;
}

export type PublishDefinitionFailure =
  DefinitionNotFound | RevisionNotFound | AlreadyPublished | LoweringDenied;

/**
 * Points the definition at one of its revisions: new records and every later change of a
 * record are written under it (a record keeps the revision it was last written under, V3).
 * Publishing a revision that leaves plain a field the served revision marks sensitive (a
 * rollback) lowers its sensitivity: it needs `objects.definitions.lower-sensitivity` and is
 * audited, as saving such a revision is (security review of PR #35, M-new-1).
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
    const read = await this.unitOfWork.run<
      { revision: RevisionRecord; lowered: Id<'Field'>[] },
      DefinitionNotFound | RevisionNotFound
    >(
      tenant,
      async () => {
        const definition = await this.definitions.find(tenant, input.definitionId);
        if (definition === null) return err(DEFINITION_NOT_FOUND);
        const revision = await this.definitions.findRevision(tenant, input.revisionId);
        // Another definition's revision answers as one that does not exist.
        if (revision === null || revision.definitionId !== definition.id) {
          return err(REVISION_NOT_FOUND);
        }
        // The comparison below holds for the version the caller names only.
        if (definition.version !== input.version) {
          throw new StaleAggregateError('objects.definition', definition.id);
        }
        const served =
          definition.publishedRevisionId === null
            ? null
            : await this.definitions.findRevision(tenant, definition.publishedRevisionId);
        const plain = new Set(revision.fields.filter((f) => !f.sensitive).map((f) => f.id));
        const lowered = (served?.fields ?? [])
          .filter((field) => field.sensitive && plain.has(field.id))
          .map((field) => field.id);
        return ok({ revision, lowered });
      },
      { readOnly: true },
    );
    if (!read.ok) return read;
    const { revision, lowered } = read.value;
    if (
      lowered.length > 0 &&
      !(await this.reach.covers(context, OBJECTS_DEFINITIONS_LOWER_SENSITIVITY.key, reached.siteId))
    ) {
      return err({ code: 'objects.revision.lowering-denied' } as const);
    }
    return this.unitOfWork.run<void, PublishDefinitionFailure>(tenant, async () => {
      const definition = await this.definitions.find(tenant, input.definitionId);
      if (definition === null) return err(DEFINITION_NOT_FOUND);
      const next = planPublish(definition, revision.id);
      if (!next.ok) return next;
      // Throws on another version: nothing published since the comparison above.
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
      if (lowered.length > 0) {
        await this.audit.record(
          context,
          REVISION_SENSITIVITY_LOWERED.entry(revision.id, {
            after: { definitionId: definition.id, fieldIds: [...lowered].sort() },
          }),
        );
      }
      return ok(undefined);
    });
  }
}
