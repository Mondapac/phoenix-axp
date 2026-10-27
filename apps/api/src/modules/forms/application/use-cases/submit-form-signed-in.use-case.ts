import { err } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type ActorGrantReader,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { RateLimited } from '../../../../platform/rate-limit';
import { channelOf } from '../../domain/submission';
import { readAnswers } from '../answers';
import { FORM_NOT_FOUND, type FormNotFound } from '../failures';
import type { InvalidAnswers } from '../ports/form-schema-checker';
import {
  submitterOf,
  type SubmissionIntake,
  type SubmissionUnavailable,
  type SubmittedForm,
} from '../submission-intake';

export interface SubmitFormSignedInInput {
  /** The form's key, as the public form page knows it. */
  readonly formKey: string;
  /** The answers by property name, as JSON Forms produces them. */
  readonly answers: unknown;
  /** The client's address; the rate limit counts the account, so it is unused here. */
  readonly clientAddress: string;
}

export type SubmitFormSignedInFailure =
  FormNotFound | InvalidAnswers | RateLimited | SubmissionUnavailable;

/**
 * Submits a published form for oneself, signed in (phase 2 review, slice 2.5): a portal user
 * under `anyone` or `portal-user`, a staff member under `anyone`, `staff` or, holding a listed
 * role, `staff-roles`. `own-resources`: the session is checked by the gate; the submission is
 * the caller's own, recorded with their account. No CAPTCHA: the session is the proof. A form
 * that does not admit the caller answers as one that does not exist.
 */
export class SubmitFormSignedIn extends UseCase<
  SubmitFormSignedInInput,
  SubmittedForm,
  SubmitFormSignedInFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.submit-form-signed-in',
    rule: { kind: 'own-resources' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly intake: SubmissionIntake,
    private readonly grants: ActorGrantReader,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: SubmitFormSignedInInput,
  ): Promise<Result<SubmittedForm, SubmitFormSignedInFailure>> {
    const limited = await this.intake.limit(context, input.clientAddress);
    if (!limited.ok) return limited;
    const served = await this.intake.served(context.tenant, input.formKey);
    if (served === null) return err(FORM_NOT_FOUND);
    const submitter = await submitterOf(context, served.form, this.grants);
    if (submitter.kind === 'anonymous') return err(FORM_NOT_FOUND);
    const channel = channelOf(served.form.policy, submitter);
    if (!channel.ok) return err(FORM_NOT_FOUND);
    const answers = readAnswers(input.answers, served.fields);
    if (!answers.ok) return answers;
    return this.intake.take(context, served, channel.value, answers.value);
  }
}
