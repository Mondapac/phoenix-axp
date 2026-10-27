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
 * The published form of a key for a visitor without a session: only a form open to `anyone`.
 * A draft, a retired form or any other policy answers as one that does not exist. Signed-in
 * callers use {@link ViewPublishedFormSignedIn}.
 */
export class ViewPublishedForm extends UseCase<
  { readonly formKey: string },
  PublishedForm,
  FormNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.view-published-form',
    rule: { kind: 'anonymous' },
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
    const served = await this.intake.served(context.tenant, input.formKey);
    const page = served === null ? null : await publishedFormFor(context, served, this.grants);
    return page === null ? err(FORM_NOT_FOUND) : ok(page);
  }
}
