import { err } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { CaptchaRejected, CaptchaService } from '../../../../platform/captcha';
import type { RateLimited } from '../../../../platform/rate-limit';
import { channelOf } from '../../domain/submission';
import { readAnswers } from '../answers';
import { FORM_NOT_FOUND, type FormNotFound } from '../failures';
import type { InvalidAnswers } from '../ports/form-schema-checker';
import { SUBMIT_CAPTCHA_PURPOSE } from '../rate-limits';
import type { SubmissionIntake, SubmissionUnavailable, SubmittedForm } from '../submission-intake';

export interface SubmitFormInput {
  /** The form's key, as the public form page knows it. */
  readonly formKey: string;
  /** The answers by property name, as JSON Forms produces them. */
  readonly answers: unknown;
  /** The solved proof-of-work challenge. */
  readonly captcha?: string;
  /** The client's address, for the rate limit only; never stored. */
  readonly clientAddress: string;
}

export type SubmitFormFailure =
  FormNotFound | InvalidAnswers | CaptchaRejected | RateLimited | SubmissionUnavailable;

/**
 * Submits a published form without signing in (phase 2 review, slice 2.5): only a form open to
 * `anyone`, and only with a solved proof-of-work challenge. In order, before any write: the rate
 * limit, the form, the policy, the answers' shape, the CAPTCHA, then the intake's validation
 * and the write. A form that does not admit an anonymous visitor answers as one that does not
 * exist. Signed-in callers use {@link SubmitFormSignedIn} or {@link SubmitFormOnBehalf}.
 */
export class SubmitForm extends UseCase<SubmitFormInput, SubmittedForm, SubmitFormFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.submit-form',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly intake: SubmissionIntake,
    private readonly captcha: CaptchaService,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: SubmitFormInput,
  ): Promise<Result<SubmittedForm, SubmitFormFailure>> {
    const limited = await this.intake.limit(context, input.clientAddress);
    if (!limited.ok) return limited;
    const served = await this.intake.served(context.tenant, input.formKey);
    if (served === null) return err(FORM_NOT_FOUND);
    const channel = channelOf(served.form.policy, { kind: 'anonymous' });
    if (!channel.ok) return err(FORM_NOT_FOUND);
    const answers = readAnswers(input.answers, served.fields);
    if (!answers.ok) return answers;
    const solved = await this.captcha.verify(context.tenant, SUBMIT_CAPTCHA_PURPOSE, input.captcha);
    if (!solved.ok) return solved;
    return this.intake.take(context, served, channel.value, answers.value);
  }
}
