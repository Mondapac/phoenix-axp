import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_VIEW } from '../../contracts/permissions';
import { FORM_REVISION_NOT_FOUND, type FormRevisionNotFound } from '../failures';
import type { FormRepository, FormRevisionRecord } from '../form.repository';

/** One revision with its two documents, as saved. */
export class ViewFormRevision extends UseCase<
  { readonly revisionId: Id<'FormRevision'> },
  FormRevisionRecord,
  FormRevisionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.view-form-revision',
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
    input: { readonly revisionId: Id<'FormRevision'> },
  ): Promise<Result<FormRevisionRecord, FormRevisionNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<FormRevisionRecord, FormRevisionNotFound>(
      tenant,
      async () => {
        const revision = await this.forms.findRevision(tenant, input.revisionId);
        return revision === null ? err(FORM_REVISION_NOT_FOUND) : ok(revision);
      },
      { readOnly: true },
    );
  }
}
