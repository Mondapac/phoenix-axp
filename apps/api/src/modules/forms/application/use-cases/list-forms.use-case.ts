import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_VIEW } from '../../contracts/permissions';
import type { FormFilter, FormRecord, FormRepository } from '../form.repository';

/** The tenant's forms, optionally of one site or in one status, by name. */
export class ListForms extends UseCase<FormFilter, FormRecord[], never> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.list-forms',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext, input: FormFilter): Promise<Result<FormRecord[], never>> {
    const { tenant } = context;
    return this.unitOfWork.run<FormRecord[], never>(
      tenant,
      async () => ok(await this.forms.list(tenant, input)),
      { readOnly: true },
    );
  }
}
