import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import {
  FieldPolicy,
  UseCase,
  type AccessDeclaration,
  type FieldDenied,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_RECORD_CREATE } from '../../contracts/permissions';
import { RECORD_CREATED } from '../../domain/audit-actions';
import { applyChanges, parseChanges, payloadFieldIds } from '../../domain/record-values';
import type { DefinitionRepository } from '../definition.repository';
import {
  DEFINITION_NOT_FOUND,
  NOT_ACCEPTING,
  SITE_NOT_FOUND,
  type DefinitionNotFound,
  type InvalidRecord,
  type NotAccepting,
  type SiteNotFound,
} from '../failures';
import { descriptorsOf, type RecordAccess } from '../record-access';
import type { RecordRepository } from '../record.repository';
import { sealedText, splitValues, SUBJECT_KEY_MODULE } from '../records';
import { CREATE_OPERATIONS, servedDefinition } from '../served-definition';

export interface CreateRecordInput {
  readonly definitionKey: string;
  /** The owning site: the definition's site when absent, else a site below it. */
  readonly siteId: Id<'Site'> | null;
  /** By API key. */
  readonly values: Readonly<Record<string, unknown>>;
}

export interface WrittenRecord {
  readonly id: Id<'ObjectRecord'>;
  readonly version: number;
}

export type CreateRecordFailure =
  DefinitionNotFound | SiteNotFound | NotAccepting | FieldDenied | InvalidRecord;

/**
 * Creates a record under the definition's published revision (ADR-0017). Check order
 * (ADR-0024 decision 2): tenant, the owning site against the create grants, the definition
 * qualifier, then field modes: a payload naming any field that is not `edit` is refused
 * whatever its value. Sensitive values are sealed under the record's new subject key.
 */
export class CreateRecord extends UseCase<CreateRecordInput, WrittenRecord, CreateRecordFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.create-record',
    rule: { kind: 'permissions', allOf: [OBJECTS_RECORD_CREATE.key] },
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
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: CreateRecordInput,
  ): Promise<Result<WrittenRecord, CreateRecordFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') return err(DEFINITION_NOT_FOUND);
    const served = await servedDefinition(
      this.unitOfWork,
      this.definitions,
      tenant,
      input.definitionKey,
    );
    if (served === null) return err(DEFINITION_NOT_FOUND);
    const { definition, current } = served;
    const siteId = input.siteId ?? definition.siteId;
    if (!(await this.access.inDefinitionTree(context, definition, siteId))) {
      return err(SITE_NOT_FOUND);
    }
    const writer = await this.access.at(
      context,
      definition.id,
      siteId,
      CREATE_OPERATIONS,
      descriptorsOf(current.fields, current.fields),
    );
    if (!writer.canWrite) return err(input.siteId === null ? DEFINITION_NOT_FOUND : SITE_NOT_FOUND);
    if (definition.status !== 'published') return err(NOT_ACCEPTING);
    const allowed = FieldPolicy.checkWrite(
      payloadFieldIds(current.fields, input.values),
      writer.writeModes,
    );
    if (!allowed.ok) return allowed;
    const changes = parseChanges(current.fields, input.values);
    if (!changes.ok) return changes;
    const values = applyChanges(
      current.fields,
      new Map(),
      changes.value,
      (id) => writer.writeModes.get(id) === 'edit',
    );
    if (!values.ok) return values;
    // Sealing is CPU work: before the unit.
    const id = this.ids.next<'ObjectRecord'>();
    const { plain, sensitive } = splitValues(current.fields, values.value);
    const sealed = this.subjectKeys.seal(tenant, id, sealedText(sensitive));
    const fieldIds = [...values.value.keys()].sort();

    return this.unitOfWork.run<WrittenRecord, CreateRecordFailure>(tenant, async () => {
      const at = this.clock.now();
      await this.records.insert(
        tenant,
        {
          id,
          definitionId: definition.id,
          revisionId: current.id,
          revisionHash: current.contentHash,
          siteId,
          createdBy: actor.accountId,
          values: plain,
          sealed: sealed.ciphertext,
        },
        at,
      );
      await this.subjectKeys.store(tenant, id, SUBJECT_KEY_MODULE, sealed.wrappedKey, at);
      await this.audit.record(
        context,
        RECORD_CREATED.entry(id, {
          after: { definitionId: definition.id, revisionId: current.id, siteId, fieldIds },
        }),
      );
      return ok({ id, version: 1 });
    });
  }
}
