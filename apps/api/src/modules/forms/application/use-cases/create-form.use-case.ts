import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type SiteAncestryReader,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_DESIGN } from '../../contracts/permissions';
import { FORM_CREATED } from '../../domain/audit-actions';
import { parseFormKey, parseName } from '../../domain/values';
import { SITE_NOT_FOUND, type InvalidValue, type KeyTaken, type SiteNotFound } from '../failures';
import type { FormRepository } from '../form.repository';
import { parseSettings, settingsAudit, type FormSettingsInput } from '../form-settings-input';

export interface CreateFormInput extends FormSettingsInput {
  /** The site whose form inbox receives the submissions. */
  readonly siteId: Id<'Site'>;
  readonly key: string;
  readonly name: string;
}

export type CreateFormFailure = InvalidValue | SiteNotFound | KeyTaken;

/** Creates a form as a draft, with its submission policy and retention, and no revision yet. */
export class CreateForm extends UseCase<CreateFormInput, { id: Id<'Form'> }, CreateFormFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.create-form',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_DESIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly sites: SiteAncestryReader,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: CreateFormInput,
  ): Promise<Result<{ id: Id<'Form'> }, CreateFormFailure>> {
    const key = parseFormKey(input.key);
    if (!key.ok) return key;
    const name = parseName(input.name);
    if (!name.ok) return name;
    const settings = parseSettings(input);
    if (!settings.ok) return settings;
    // A port call reads in a unit of its own, so it comes before this one (no facade call
    // inside a unit). Sites are not deleted, so the answer still holds at the insert.
    if (!(await this.sites.siteExists(context, input.siteId))) return err(SITE_NOT_FOUND);
    const id = this.ids.next<'Form'>();
    const { tenant } = context;
    const { policy, retention } = settings.value;

    return this.unitOfWork.run<{ id: Id<'Form'> }, CreateFormFailure>(tenant, async () => {
      const created = await this.forms.insert(
        tenant,
        { id, siteId: input.siteId, key: key.value, name: name.value, policy, retention },
        this.clock.now(),
      );
      if (created === 'key-taken') return err({ code: 'forms.form.key-taken' } as const);
      await this.audit.record(
        context,
        FORM_CREATED.entry(id, {
          after: { siteId: input.siteId, ...settingsAudit(policy, retention) },
        }),
      );
      return ok({ id });
    });
  }
}
