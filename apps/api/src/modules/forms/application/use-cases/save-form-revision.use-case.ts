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
import { FORMS_FORMS_DESIGN, FORMS_FORMS_LOWER_SENSITIVITY } from '../../contracts/permissions';
import { FORM_REVISION_SAVED, FORM_SENSITIVITY_LOWERED } from '../../domain/audit-actions';
import { assignFields, type FieldSettingInput, type FormField } from '../../domain/form-fields';
import type { InvalidValue } from '../../domain/values';
import { FORM_NOT_FOUND, type FormNotFound, type InvalidSchema } from '../failures';
import type { FormReach } from '../form-reach';
import type { FormRepository } from '../form.repository';
import type { FormSchemaChecker } from '../ports/form-schema-checker';
import { checkRevisionDocuments } from '../revision-documents';

export interface SaveFormRevisionInput {
  readonly formId: Id<'Form'>;
  /** The JSON Schema of the data; parsed JSON, checked here. */
  readonly jsonSchema: unknown;
  /** The JSON Forms UI Schema of the layout. */
  readonly uiSchema: unknown;
  /**
   * Settings of fields by property name (all optional): `id` to keep a field of the previous
   * revision under a new name, `sensitive`, `portal`. Unnamed properties keep their previous
   * id and settings by name, or start sensitive and hidden from the portal.
   */
  readonly fields?: Readonly<Record<string, FieldSettingInput>>;
}

export interface SavedRevision {
  readonly id: Id<'FormRevision'>;
  readonly number: number;
  readonly contentHash: ContentHash;
  readonly fields: readonly FormField[];
}

/** Lowering a field's sensitivity needs the protected key (ADR-0024 decision 4). */
export type LowerSensitivityDenied = { readonly code: 'forms.form-revision.lowering-denied' };

export type SaveFormRevisionFailure =
  InvalidSchema | InvalidValue | FormNotFound | LowerSensitivityDenied;

/**
 * Saves a new immutable revision of a form (ADR-0007 V1) under the next number, with a stable
 * id for each of its fields (ADR-0024). Saving does not publish: the form keeps serving the
 * revision it points at until a publisher publishes another one.
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
    private readonly reach: FormReach,
    private readonly checker: FormSchemaChecker,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: SaveFormRevisionInput,
  ): Promise<Result<SavedRevision, SaveFormRevisionFailure>> {
    // Schema compilation and hashing are CPU work: before the unit, never inside it.
    const documents = await checkRevisionDocuments(this.checker, input.jsonSchema, input.uiSchema);
    if (!documents.ok) return documents;
    const form = await this.reach.form(context, FORMS_FORMS_DESIGN.key, input.formId);
    if (form === null) return err(FORM_NOT_FOUND);
    // Asked before the unit (a port call); used only if a field is lowered.
    const mayLower = await this.reach.covers(
      context,
      FORMS_FORMS_LOWER_SENSITIVITY.key,
      form.siteId,
    );
    const id = this.ids.next<'FormRevision'>();
    const names = Object.keys(documents.value.jsonSchema.properties as object);
    const { tenant } = context;

    return this.unitOfWork.run<SavedRevision, SaveFormRevisionFailure>(tenant, async () => {
      // The number first: its row lock orders concurrent saves, so the previous revision read
      // next is the one this revision follows.
      const number = await this.forms.takeRevisionNumber(tenant, form.id);
      if (number === null) return err(FORM_NOT_FOUND);
      const previous =
        number > 1 ? await this.forms.revisionFields(tenant, form.id, number - 1) : null;
      const assigned = assignFields(names, previous, input.fields ?? {}, () =>
        this.ids.next<'Field'>(),
      );
      if (!assigned.ok) return assigned;
      const { fields, lowered } = assigned.value;
      if (lowered.length > 0 && !mayLower) {
        return err({ code: 'forms.form-revision.lowering-denied' } as const);
      }
      await this.forms.insertRevision(tenant, {
        id,
        formId: form.id,
        number,
        ...documents.value,
        fields,
        createdAt: this.clock.now(),
      });
      await this.audit.record(
        context,
        FORM_REVISION_SAVED.entry(id, { after: { formId: form.id, number } }),
      );
      if (lowered.length > 0) {
        await this.audit.record(
          context,
          FORM_SENSITIVITY_LOWERED.entry(id, { after: { formId: form.id, fieldIds: lowered } }),
        );
      }
      return ok({ id, number, contentHash: documents.value.contentHash, fields });
    });
  }
}
