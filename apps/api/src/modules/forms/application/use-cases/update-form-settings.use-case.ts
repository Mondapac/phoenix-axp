import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_PUBLISH } from '../../contracts/permissions';
import { FORM_UPDATED } from '../../domain/audit-actions';
import { FORM_NOT_FOUND, type FormNotFound, type InvalidValue } from '../failures';
import { parseSettings, settingsAudit, type FormSettingsInput } from '../form-settings-input';
import type { FormReach } from '../form-reach';
import type { FormRepository } from '../form.repository';

export interface UpdateFormSettingsInput extends FormSettingsInput {
  readonly formId: Id<'Form'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
}

export type UpdateFormSettingsFailure = InvalidValue | FormNotFound;

/**
 * Replaces the submission policy and retention of a form in any status: who may submit a live
 * form and how long its personal data is kept are a publisher's decision (D7, security review
 * M2). A shorter retention applies to the submissions the retention job (slice 2.5) finds past
 * it.
 */
export class UpdateFormSettings extends UseCase<
  UpdateFormSettingsInput,
  void,
  UpdateFormSettingsFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.update-form-settings',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_PUBLISH.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly reach: FormReach,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: UpdateFormSettingsInput,
  ): Promise<Result<void, UpdateFormSettingsFailure>> {
    const settings = parseSettings(input);
    if (!settings.ok) return settings;
    if ((await this.reach.form(context, FORMS_FORMS_PUBLISH.key, input.formId)) === null) {
      return err(FORM_NOT_FOUND);
    }
    const { policy, retention } = settings.value;
    const { tenant } = context;

    return this.unitOfWork.run<void, UpdateFormSettingsFailure>(tenant, async () => {
      const form = await this.forms.find(tenant, input.formId);
      if (form === null) return err(FORM_NOT_FOUND);
      await this.forms.saveState(
        tenant,
        form.id,
        input.version,
        { policy, retention },
        this.clock.now(),
      );
      await this.audit.record(
        context,
        FORM_UPDATED.entry(form.id, {
          before: settingsAudit(form.policy, form.retention),
          after: { ...settingsAudit(policy, retention), nameChanged: false },
        }),
      );
      return ok(undefined);
    });
  }
}
