import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_VIEW } from '../../contracts/permissions';
import { FORM_NOT_FOUND, type FormNotFound } from '../failures';
import type { FormRecord, FormRepository, FormRevisionSummary } from '../form.repository';

export interface FormView extends FormRecord {
  /** Every revision, newest first, without their documents. */
  readonly revisions: readonly FormRevisionSummary[];
}

/** One form with the list of its revisions. */
export class ViewForm extends UseCase<{ readonly formId: Id<'Form'> }, FormView, FormNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.view-form',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: { readonly formId: Id<'Form'> },
  ): Promise<Result<FormView, FormNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<FormView, FormNotFound>(
      tenant,
      async () => {
        const form = await this.forms.find(tenant, input.formId);
        if (form === null) return err(FORM_NOT_FOUND);
        return ok({ ...form, revisions: await this.forms.listRevisions(tenant, form.id) });
      },
      { readOnly: true },
    );
  }
}
