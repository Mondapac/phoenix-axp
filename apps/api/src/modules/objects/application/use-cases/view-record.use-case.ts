import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_RECORD_READ } from '../../contracts/permissions';
import type { DefinitionRepository } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  RECORD_NOT_FOUND,
  type DefinitionNotFound,
  type RecordNotFound,
} from '../failures';
import type { RecordAccess } from '../record-access';
import { recordViews } from '../record-views';
import type { RecordRepository } from '../record.repository';
import { keysOf, type RecordView } from '../records';
import { servedDefinition } from '../served-definition';

export interface ViewRecordInput {
  readonly definitionKey: string;
  readonly recordId: Id<'ObjectRecord'>;
}

/**
 * One record through FieldPolicy. A record outside the caller's site, definition or read grant
 * answers as not found (ADR-0004: another owner's resource is "not found").
 */
export class ViewRecord extends UseCase<
  ViewRecordInput,
  RecordView,
  DefinitionNotFound | RecordNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.view-record',
    rule: { kind: 'permissions', allOf: [OBJECTS_RECORD_READ.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly records: RecordRepository,
    private readonly access: RecordAccess,
    private readonly subjectKeys: SubjectKeyService,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: ViewRecordInput,
  ): Promise<Result<RecordView, DefinitionNotFound | RecordNotFound>> {
    const { tenant } = context;
    const served = await servedDefinition(
      this.unitOfWork,
      this.definitions,
      tenant,
      input.definitionKey,
    );
    if (served === null) return err(DEFINITION_NOT_FOUND);
    const { definition, current } = served;
    if (!(await this.access.reaches(context, definition, OBJECTS_RECORD_READ.key))) {
      return err(DEFINITION_NOT_FOUND);
    }
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const record = await this.records.find(tenant, definition.id, input.recordId);
        if (record === null) return ok(null);
        const revisions = await this.definitions.revisions(tenant, [record.revisionId]);
        const keys = await keysOf(this.subjectKeys, context, [record]);
        return ok({ record, revisions, keys });
      },
      { readOnly: true },
    );
    if (!read.ok) throw new Error('objects: the record could not be read');
    if (read.value === null) return err(RECORD_NOT_FOUND);
    const { record, revisions, keys } = read.value;
    const [view] = await recordViews(
      this.access,
      this.subjectKeys,
      context,
      definition,
      current,
      [record],
      revisions,
      keys,
    );
    return view === undefined ? err(RECORD_NOT_FOUND) : ok(view);
  }
}
