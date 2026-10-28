import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_RECORD_DELETE } from '../../contracts/permissions';
import { RECORD_DELETED } from '../../domain/audit-actions';
import type { DefinitionRepository } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  RECORD_NOT_FOUND,
  type DefinitionNotFound,
  type RecordNotFound,
} from '../failures';
import type { RecordAccess } from '../record-access';
import type { RecordRepository } from '../record.repository';
import { DELETE_OPERATIONS, servedDefinition } from '../served-definition';

export interface DeleteRecordInput {
  readonly definitionKey: string;
  readonly recordId: Id<'ObjectRecord'>;
  readonly version: number;
}

/**
 * Removes a record and destroys its subject key in one unit, so its sealed values can never be
 * opened again (ADR-0017 decision 4). Works on a retired definition too. A stale version
 * answers 409.
 */
export class DeleteRecord extends UseCase<
  DeleteRecordInput,
  void,
  DefinitionNotFound | RecordNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.delete-record',
    rule: { kind: 'permissions', allOf: [OBJECTS_RECORD_DELETE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly records: RecordRepository,
    private readonly access: RecordAccess,
    private readonly subjectKeys: SubjectKeyService,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: DeleteRecordInput,
  ): Promise<Result<void, DefinitionNotFound | RecordNotFound>> {
    const { tenant } = context;
    const served = await servedDefinition(
      this.unitOfWork,
      this.definitions,
      tenant,
      input.definitionKey,
    );
    if (served === null) return err(DEFINITION_NOT_FOUND);
    const { definition } = served;
    if (!(await this.access.reaches(context, definition, OBJECTS_RECORD_DELETE.key))) {
      return err(DEFINITION_NOT_FOUND);
    }
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.records.find(tenant, definition.id, input.recordId)),
      { readOnly: true },
    );
    if (!read.ok) throw new Error('objects: the record could not be read');
    const record = read.value;
    if (record === null) return err(RECORD_NOT_FOUND);
    const deleter = await this.access.at(
      context,
      definition.id,
      record.siteId,
      DELETE_OPERATIONS,
      [],
    );
    if (!deleter.canWrite) return err(RECORD_NOT_FOUND);

    return this.unitOfWork.run<void, DefinitionNotFound | RecordNotFound>(tenant, async () => {
      await this.records.delete(tenant, record.id, input.version);
      await this.subjectKeys.destroy(tenant, record.id, this.clock.now());
      await this.audit.record(
        context,
        RECORD_DELETED.entry(record.id, {
          before: { definitionId: definition.id, siteId: record.siteId },
        }),
      );
      return ok(undefined);
    });
  }
}
