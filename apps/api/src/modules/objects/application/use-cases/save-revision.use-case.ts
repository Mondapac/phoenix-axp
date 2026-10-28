import { createHash } from 'node:crypto';
import { canonicalJson, err, ok } from '@phoenix/shared-kernel';
import type {
  CallContext,
  Clock,
  ContentHash,
  Id,
  IdGenerator,
  Result,
} from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import {
  OBJECTS_DEFINITIONS_DESIGN,
  OBJECTS_DEFINITIONS_LOWER_SENSITIVITY,
} from '../../contracts/permissions';
import { REVISION_SAVED, REVISION_SENSITIVITY_LOWERED } from '../../domain/audit-actions';
import { assignFields, type FieldInput, type ObjectField } from '../../domain/fields';
import type { DefinitionReach } from '../definition-reach';
import type { DefinitionRepository } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  type DefinitionNotFound,
  type InvalidValue,
  type LoweringDenied,
  type RevisionOutdated,
} from '../failures';

export interface SaveRevisionInput {
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly fields: readonly FieldInput[];
}

export interface SavedRevision {
  readonly id: Id<'ObjectRevision'>;
  readonly number: number;
  readonly contentHash: ContentHash;
  readonly fields: readonly ObjectField[];
}

export type SaveRevisionFailure =
  InvalidValue | DefinitionNotFound | LoweringDenied | RevisionOutdated;

/** `sha256:` over the canonical JSON of the fields (ADR-0007 V3: records keep it). */
export function fieldsHash(fields: readonly ObjectField[]): ContentHash {
  const text = canonicalJson(fields);
  if (!text.ok) throw new Error('objects: fields are not canonical JSON');
  return `sha256:${createHash('sha256').update(text.value, 'utf8').digest('hex')}` as ContentHash;
}

/**
 * Saves a new immutable revision of a definition (ADR-0007 V1) under the next number, with a
 * stable id for each field (ADR-0024). Saving does not publish. The fields are assigned and
 * hashed before the unit (no hashing inside a unit), against the newest revision read before
 * it; when another save took a number in between, the save answers `outdated`.
 */
export class SaveRevision extends UseCase<SaveRevisionInput, SavedRevision, SaveRevisionFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.save-revision',
    rule: { kind: 'permissions', allOf: [OBJECTS_DEFINITIONS_DESIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly reach: DefinitionReach,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: SaveRevisionInput,
  ): Promise<Result<SavedRevision, SaveRevisionFailure>> {
    const definition = await this.reach.definition(
      context,
      OBJECTS_DEFINITIONS_DESIGN.key,
      input.definitionId,
    );
    if (definition === null) return err(DEFINITION_NOT_FOUND);
    const { tenant } = context;
    const latest = definition.latestRevisionNumber;
    const read = await this.unitOfWork.run(
      tenant,
      async () =>
        ok(
          latest === 0
            ? null
            : await this.definitions.revisionByNumber(tenant, definition.id, latest),
        ),
      { readOnly: true },
    );
    if (!read.ok) return err(DEFINITION_NOT_FOUND);
    const assigned = assignFields(input.fields, read.value?.fields ?? null, () =>
      this.ids.next<'Field'>(),
    );
    if (!assigned.ok) return assigned;
    const { fields, lowered } = assigned.value;
    if (
      lowered.length > 0 &&
      !(await this.reach.covers(
        context,
        OBJECTS_DEFINITIONS_LOWER_SENSITIVITY.key,
        definition.siteId,
      ))
    ) {
      return err({ code: 'objects.revision.lowering-denied' } as const);
    }
    const contentHash = fieldsHash(fields);
    const id = this.ids.next<'ObjectRevision'>();

    return this.unitOfWork.run<SavedRevision, SaveRevisionFailure>(tenant, async () => {
      // The row lock of the number orders concurrent saves; a save that does not follow the
      // revision it was assigned against is outdated.
      const number = await this.definitions.takeRevisionNumber(tenant, definition.id);
      if (number === null) return err(DEFINITION_NOT_FOUND);
      if (number !== latest + 1) return err({ code: 'objects.revision.outdated' } as const);
      await this.definitions.insertRevision(tenant, {
        id,
        definitionId: definition.id,
        number,
        fields,
        contentHash,
        createdAt: this.clock.now(),
      });
      await this.audit.record(
        context,
        REVISION_SAVED.entry(id, { after: { definitionId: definition.id, number } }),
      );
      if (lowered.length > 0) {
        await this.audit.record(
          context,
          REVISION_SENSITIVITY_LOWERED.entry(id, {
            after: { definitionId: definition.id, fieldIds: lowered },
          }),
        );
      }
      return ok({ id, number, contentHash, fields });
    });
  }
}
