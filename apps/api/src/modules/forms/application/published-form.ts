import type { CallContext, Id } from '@phoenix/shared-kernel';
import type { ActorGrantReader } from '../../../platform/authz';
import { FORMS_SUBMISSION_SUBMIT_ON_BEHALF } from '../contracts/permissions';
import type { JsonObject } from '../domain/form-schema';
import { channelOf } from '../domain/submission';
import { submitterOf, type ServedForm } from './submission-intake';

/** What the public form page renders: the published revision's documents, no settings. */
export interface PublishedForm {
  readonly name: string;
  readonly revisionId: Id<'FormRevision'>;
  readonly jsonSchema: JsonObject;
  readonly uiSchema: JsonObject;
  /** True for a visitor without a session: the submission needs a solved challenge. */
  readonly captchaRequired: boolean;
  /**
   * True when the form allows submitting on behalf of someone and the caller is a staff member
   * holding the key somewhere; whether it covers this form is decided on submitting.
   */
  readonly onBehalfOffered: boolean;
}

/**
 * The page of `served` for the caller, or null when its policy admits them neither for
 * themselves nor on behalf of someone else. Field settings (sensitivity, portal modes) are not
 * part of it.
 */
export async function publishedFormFor(
  context: CallContext,
  served: ServedForm,
  grants: ActorGrantReader,
): Promise<PublishedForm | null> {
  const { form, revision } = served;
  const submitter = await submitterOf(context, form, grants);
  const onBehalfOffered =
    submitter.kind === 'staff' &&
    form.policy.allowOnBehalf &&
    (await grants.grantsOf(context)).some((grant) =>
      grant.keys.has(FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key),
    );
  if (!channelOf(form.policy, submitter).ok && !onBehalfOffered) return null;
  return {
    name: form.name,
    revisionId: revision.id,
    jsonSchema: revision.jsonSchema,
    uiSchema: revision.uiSchema,
    captchaRequired: submitter.kind === 'anonymous',
    onBehalfOffered,
  };
}
