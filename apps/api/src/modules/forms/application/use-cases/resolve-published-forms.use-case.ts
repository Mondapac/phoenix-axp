import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { MAX_FORM_REFERENCES, type PublishedFormReference } from '../../contracts/form-references';
import { FORMS_FORMS_PUBLISH, FORMS_FORMS_VIEW } from '../../contracts/permissions';
import type { FormRepository } from '../form.repository';
import type { FormReach } from '../form-reach';

export interface ResolvePublishedFormsInput {
  readonly keys: readonly string[];
  /** The key of the form that starts a process, if one does. */
  readonly startKey?: string;
}

/**
 * The published forms of some keys, for another module to pin (the forms facade; slice 2.6).
 * Only forms the caller may view are answered, at their sites (ADR-0018 decision 6); a draft or
 * retired form, or one out of reach, is left out like a key that names nothing. The form that
 * starts a process (`startKey`) routes every submission of it, so it needs `forms.forms.publish`
 * at its site as well, as publishing the form itself does.
 */
export class ResolvePublishedForms extends UseCase<
  ResolvePublishedFormsInput,
  readonly PublishedFormReference[]
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.resolve-published-forms',
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
    input: ResolvePublishedFormsInput,
  ): Promise<Result<readonly PublishedFormReference[], never>> {
    const keys = [...new Set(input.keys)];
    if (keys.length === 0 || keys.length > MAX_FORM_REFERENCES) return ok([]);
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.forms.findByKeys(tenant, keys)),
      { readOnly: true },
    );
    if (!read.ok) return ok([]);
    const viewed = await this.reach.filter(context, FORMS_FORMS_VIEW.key, read.value);
    const start = viewed.filter((form) => form.key === input.startKey);
    const routed = await this.reach.filter(context, FORMS_FORMS_PUBLISH.key, start);
    const reached = viewed.filter((form) => form.key !== input.startKey || routed.includes(form));
    return ok(
      reached.flatMap((form) =>
        form.status === 'published' && form.publishedRevisionId !== null
          ? [{ key: form.key, formId: form.id, revisionId: form.publishedRevisionId }]
          : [],
      ),
    );
  }
}
