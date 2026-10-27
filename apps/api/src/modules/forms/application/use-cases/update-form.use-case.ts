import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_DESIGN } from '../../contracts/permissions';
import { FORM_UPDATED } from '../../domain/audit-actions';
import { sameSettings } from '../../domain/form-settings';
import { parseName } from '../../domain/values';
import {
  FORM_NOT_FOUND,
  type FormNotFound,
  type InvalidValue,
  type SettingsNeedPublisher,
} from '../failures';
import type { FormReach } from '../form-reach';
import type { FormRepository } from '../form.repository';
import { parseSettings, settingsAudit, type FormSettingsInput } from '../form-settings-input';

export interface UpdateFormInput extends FormSettingsInput {
  readonly formId: Id<'Form'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
  readonly name: string;
}

export type UpdateFormFailure = InvalidValue | FormNotFound | SettingsNeedPublisher;

/**
 * Renames a form and, while it is a draft, replaces its submission policy and retention. Once
 * published, those two belong to a publisher (`UpdateFormSettings`); here they must then stay
 * as they are. The key and the site do not change.
 */
export class UpdateForm extends UseCase<UpdateFormInput, void, UpdateFormFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.update-form',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_DESIGN.key] },
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
    input: UpdateFormInput,
  ): Promise<Result<void, UpdateFormFailure>> {
    const name = parseName(input.name);
    if (!name.ok) return name;
    const settings = parseSettings(input);
    if (!settings.ok) return settings;
    if ((await this.reach.form(context, FORMS_FORMS_DESIGN.key, input.formId)) === null) {
      return err(FORM_NOT_FOUND);
    }
    const { policy, retention } = settings.value;
    const { tenant } = context;

    return this.unitOfWork.run<void, UpdateFormFailure>(tenant, async () => {
      const form = await this.forms.find(tenant, input.formId);
      if (form === null) return err(FORM_NOT_FOUND);
      if (form.status !== 'draft' && !sameSettings(form, settings.value)) {
        return err({ code: 'forms.form.settings-need-publisher' } as const);
      }
      await this.forms.saveState(
        tenant,
        form.id,
        input.version,
        { name: name.value, policy, retention },
        this.clock.now(),
      );
      await this.audit.record(
        context,
        FORM_UPDATED.entry(form.id, {
          before: settingsAudit(form.policy, form.retention),
          after: { ...settingsAudit(policy, retention), nameChanged: name.value !== form.name },
        }),
      );
      return ok(undefined);
    });
  }
}
