import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_PUBLISH } from '../../contracts/permissions';
import { FORM_RETIRED } from '../../domain/audit-actions';
import { planRetire } from '../../domain/lifecycle';
import { FORM_NOT_FOUND, type FormNotFound, type NotPublished } from '../failures';
import type { FormRepository } from '../form.repository';

export interface RetireFormInput {
  readonly formId: Id<'Form'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
}

export type RetireFormFailure = FormNotFound | NotPublished;

/** Stops new submissions of a published form; its submissions and revisions stay. */
export class RetireForm extends UseCase<RetireFormInput, void, RetireFormFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.retire-form',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_PUBLISH.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: RetireFormInput,
  ): Promise<Result<void, RetireFormFailure>> {
    const { tenant } = context;
    return this.unitOfWork.run<void, RetireFormFailure>(tenant, async () => {
      const form = await this.forms.find(tenant, input.formId);
      if (form === null) return err(FORM_NOT_FOUND);
      const next = planRetire(form);
      if (!next.ok) return next;
      await this.forms.saveState(tenant, form.id, input.version, next.value, this.clock.now());
      await this.audit.record(
        context,
        FORM_RETIRED.entry(form.id, { before: { revisionId: form.publishedRevisionId! } }),
      );
      return ok(undefined);
    });
  }
}
