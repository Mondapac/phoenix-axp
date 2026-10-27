import { err } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import {
  FieldPolicy,
  UseCase,
  type AccessDeclaration,
  type FieldDenied,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { RateLimited } from '../../../../platform/rate-limit';
import { FORMS_SUBMISSION_SUBMIT_ON_BEHALF } from '../../contracts/permissions';
import { answersById, readAnswers } from '../answers';
import { FORM_NOT_FOUND, type FormNotFound } from '../failures';
import type { InvalidAnswers } from '../ports/form-schema-checker';
import { descriptorsOf, type SubmissionAccess } from '../submission-access';
import type { SubmissionIntake, SubmissionUnavailable, SubmittedForm } from '../submission-intake';

export interface SubmitFormOnBehalfInput {
  /** The form's key, as the public form page knows it. */
  readonly formKey: string;
  /** The answers by property name, as JSON Forms produces them. */
  readonly answers: unknown;
  /** The client's address; the rate limit counts the account, so it is unused here. */
  readonly clientAddress: string;
}

export type SubmitFormOnBehalfFailure =
  FormNotFound | InvalidAnswers | RateLimited | FieldDenied | SubmissionUnavailable;

/**
 * A staff member submits a published form for someone else (phase 2 review, slice 2.5), when
 * the form allows it. The gate checks `forms.submission.submit-on-behalf`; then, from the
 * actor's grants, the form's site and definition, and the field modes (ADR-0024 decision 7: a
 * payload naming any field the actor may not edit is refused, naming no field). The submission
 * records the staff member's account and the `on-behalf` channel; the audit row carries both
 * the actor and the submission. A form outside the actor's reach answers as not found.
 */
export class SubmitFormOnBehalf extends UseCase<
  SubmitFormOnBehalfInput,
  SubmittedForm,
  SubmitFormOnBehalfFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.submit-form-on-behalf',
    rule: { kind: 'permissions', allOf: [FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly intake: SubmissionIntake,
    private readonly access: SubmissionAccess,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: SubmitFormOnBehalfInput,
  ): Promise<Result<SubmittedForm, SubmitFormOnBehalfFailure>> {
    const limited = await this.intake.limit(context, input.clientAddress);
    if (!limited.ok) return limited;
    const served = await this.intake.served(context.tenant, input.formKey);
    if (served === null || !served.form.policy.allowOnBehalf) return err(FORM_NOT_FOUND);
    const { form, fields } = served;
    // Tenant, site, definition, then field modes, from the actor's grants (ADR-0024).
    const access = await this.access.of(context, form, descriptorsOf(fields, fields));
    if (!access.canWrite) return err(FORM_NOT_FOUND);
    const answers = readAnswers(input.answers, fields);
    if (!answers.ok) return answers;
    const allowed = FieldPolicy.checkWrite(
      Object.keys(answersById(answers.value, fields)),
      access.modes,
    );
    if (!allowed.ok) return allowed;
    return this.intake.take(context, served, 'on-behalf', answers.value);
  }
}
