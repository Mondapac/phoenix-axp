import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_VIEW } from '../../contracts/permissions';
import type { FormFilter, FormRecord, FormRepository } from '../form.repository';
import type { FormReach } from '../form-reach';

/** The forms the actor may view, optionally of one site or in one status, by name. */
export class ListForms extends UseCase<FormFilter, FormRecord[], never> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.list-forms',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly reach: FormReach,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: FormFilter,
  ): Promise<Result<FormRecord[], never>> {
    const { tenant } = context;
    const listed = await this.unitOfWork.run<FormRecord[], never>(
      tenant,
      async () => ok(await this.forms.list(tenant, input)),
      { readOnly: true },
    );
    if (!listed.ok) return listed;
    // Only the forms of the sites the actor's view grants reach (ADR-0018 decision 6).
    return ok(await this.reach.filter(context, FORMS_FORMS_VIEW.key, listed.value));
  }
}
