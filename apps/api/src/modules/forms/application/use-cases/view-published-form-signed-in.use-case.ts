import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type ActorGrantReader,
  type UseCaseGate,
} from '../../../../platform/authz';
import { FORM_NOT_FOUND, type FormNotFound } from '../failures';
import { publishedFormFor, type PublishedForm } from '../published-form';
import type { SubmissionIntake } from '../submission-intake';

/**
 * The published form of a key for a signed-in caller its policy admits, or a staff member
 * when the form allows submitting on behalf of someone. `own-resources`: the gate checks the
 * session. Anyone else, a draft or a retired form answers as one that does not exist.
 */
export class ViewPublishedFormSignedIn extends UseCase<
  { readonly formKey: string },
  PublishedForm,
  FormNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.view-published-form-signed-in',
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
    input: { readonly formKey: string },
  ): Promise<Result<PublishedForm, FormNotFound>> {
    if (context.actor.kind !== 'authenticated') return err(FORM_NOT_FOUND);
    const served = await this.intake.served(context.tenant, input.formKey);
    const page = served === null ? null : await publishedFormFor(context, served, this.grants);
    return page === null ? err(FORM_NOT_FOUND) : ok(page);
  }
}
