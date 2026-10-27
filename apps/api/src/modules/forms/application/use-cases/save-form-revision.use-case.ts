import { err, ok } from '@phoenix/shared-kernel';
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
import { FORMS_FORMS_DESIGN } from '../../contracts/permissions';
import { FORM_REVISION_SAVED } from '../../domain/audit-actions';
import { FORM_NOT_FOUND, type FormNotFound, type InvalidSchema } from '../failures';
import type { FormRepository } from '../form.repository';
import type { FormSchemaChecker } from '../ports/form-schema-checker';
import { checkRevisionDocuments } from '../revision-documents';

export interface SaveFormRevisionInput {
  readonly formId: Id<'Form'>;
  /** The JSON Schema of the data; parsed JSON, checked here. */
  readonly jsonSchema: unknown;
  /** The JSON Forms UI Schema of the layout. */
  readonly uiSchema: unknown;
}

export interface SavedRevision {
  readonly id: Id<'FormRevision'>;
  readonly number: number;
  readonly contentHash: ContentHash;
}

export type SaveFormRevisionFailure = InvalidSchema | FormNotFound;

/**
 * Saves a new immutable revision of a form (ADR-0007 V1) under the next number. Saving does
 * not publish: the form keeps serving the revision it points at until a publisher publishes
 * another one.
 */
export class SaveFormRevision extends UseCase<
  SaveFormRevisionInput,
  SavedRevision,
  SaveFormRevisionFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.save-form-revision',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_DESIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly checker: FormSchemaChecker,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: SaveFormRevisionInput,
  ): Promise<Result<SavedRevision, SaveFormRevisionFailure>> {
    // Schema compilation and hashing are CPU work: before the unit, never inside it.
    const documents = checkRevisionDocuments(this.checker, input.jsonSchema, input.uiSchema);
    if (!documents.ok) return Promise.resolve(documents);
    const id = this.ids.next<'FormRevision'>();
    const { tenant } = context;

    return this.unitOfWork.run<SavedRevision, SaveFormRevisionFailure>(tenant, async () => {
      const appended = await this.forms.appendRevision(tenant, {
        id,
        formId: input.formId,
        ...documents.value,
        createdAt: this.clock.now(),
      });
      if (appended === null) return err(FORM_NOT_FOUND);
      await this.audit.record(
        context,
        FORM_REVISION_SAVED.entry(id, { after: { formId: input.formId, number: appended.number } }),
      );
      return ok({ id, number: appended.number, contentHash: documents.value.contentHash });
    });
  }
}
