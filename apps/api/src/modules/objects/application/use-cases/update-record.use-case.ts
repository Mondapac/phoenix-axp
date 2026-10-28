import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import {
  FieldPolicy,
  UseCase,
  type AccessDeclaration,
  type FieldDenied,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_RECORD_UPDATE } from '../../contracts/permissions';
import { RECORD_UPDATED } from '../../domain/audit-actions';
import { applyChanges, parseChanges, payloadFieldIds } from '../../domain/record-values';
import type { DefinitionRepository } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  NOT_ACCEPTING,
  RECORD_NOT_FOUND,
  type DefinitionNotFound,
  type InvalidRecord,
  type NotAccepting,
  type RecordNotFound,
} from '../failures';
import { descriptorsOf, type RecordAccess } from '../record-access';
import type { RecordRepository } from '../record.repository';
import { openValues, sealedText, splitValues } from '../records';
import { servedDefinition, UPDATE_OPERATIONS } from '../served-definition';
import type { WrittenRecord } from './create-record.use-case';

export interface UpdateRecordInput {
  readonly definitionKey: string;
  readonly recordId: Id<'ObjectRecord'>;
  readonly version: number;
  /** By API key; `null` clears a field. Fields not named keep their values. */
  readonly values: Readonly<Record<string, unknown>>;
}

export type UpdateRecordFailure =
  DefinitionNotFound | RecordNotFound | NotAccepting | FieldDenied | InvalidRecord;

/**
 * Changes a record under the definition's published revision (the record moves to it, V3):
 * only fields whose mode is `edit` for the caller at the record's site may be named; values of
 * fields the revision no longer has are dropped. The caller need not be able to read the record
 * (an update-only role writes fields it cannot read back, ADR-0024 review M1). A stale version
 * answers 409.
 */
export class UpdateRecord extends UseCase<UpdateRecordInput, WrittenRecord, UpdateRecordFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.update-record',
    rule: { kind: 'permissions', allOf: [OBJECTS_RECORD_UPDATE.key] },
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
    input: UpdateRecordInput,
  ): Promise<Result<WrittenRecord, UpdateRecordFailure>> {
    const { tenant } = context;
    const served = await servedDefinition(
      this.unitOfWork,
      this.definitions,
      tenant,
      input.definitionKey,
    );
    if (served === null) return err(DEFINITION_NOT_FOUND);
    const { definition, current } = served;
    if (!(await this.access.reaches(context, definition, OBJECTS_RECORD_UPDATE.key))) {
      return err(DEFINITION_NOT_FOUND);
    }
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const record = await this.records.find(tenant, definition.id, input.recordId);
        if (record === null) return ok(null);
        const keys = await this.subjectKeys.wrappedKeys(tenant, [record.id]);
        return ok({ record, wrappedKey: keys.get(record.id) });
      },
      { readOnly: true },
    );
    if (!read.ok) throw new Error('objects: the record could not be read');
    if (read.value === null) return err(RECORD_NOT_FOUND);
    const { record, wrappedKey } = read.value;
    const writer = await this.access.at(
      context,
      definition.id,
      record.siteId,
      UPDATE_OPERATIONS,
      descriptorsOf(current.fields, current.fields),
    );
    if (!writer.canWrite) return err(RECORD_NOT_FOUND);
    if (definition.status !== 'published') return err(NOT_ACCEPTING);
    // The write is built from this read: a record changed since (another version) is refused
    // here, so no write reverts a field the caller cannot edit (security review, M1).
    if (record.version !== input.version)
      throw new StaleAggregateError('objects.record', record.id);
    // An empty change would still move the record to the published revision (review, L3).
    if (Object.keys(input.values).length === 0) return err({ code: 'objects.record.invalid' });
    const allowed = FieldPolicy.checkWrite(
      payloadFieldIds(current.fields, input.values),
      writer.writeModes,
    );
    if (!allowed.ok) return allowed;
    const changes = parseChanges(current.fields, input.values);
    if (!changes.ok) return changes;
    const existing = openValues(this.subjectKeys, tenant, record, wrappedKey);
    const values = applyChanges(
      current.fields,
      existing,
      changes.value,
      (id) => writer.writeModes.get(id) === 'edit',
      false,
    );
    if (!values.ok) return values;
    const { plain, sensitive } = splitValues(current.fields, values.value);
    const sealed = this.subjectKeys.reseal(tenant, record.id, wrappedKey, sealedText(sensitive));
    const fieldIds = [...changes.value.keys()].sort();

    return this.unitOfWork.run<WrittenRecord, UpdateRecordFailure>(tenant, async () => {
      await this.records.update(
        tenant,
        record.id,
        input.version,
        { revisionId: current.id, revisionHash: current.contentHash, values: plain, sealed },
        this.clock.now(),
      );
      await this.audit.record(
        context,
        RECORD_UPDATED.entry(record.id, {
          before: { revisionId: record.revisionId },
          after: { revisionId: current.id, fieldIds },
        }),
      );
      return ok({ id: record.id, version: input.version + 1 });
    });
  }
}
