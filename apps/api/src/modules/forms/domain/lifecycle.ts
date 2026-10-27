import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';

// The life of a form (ADR-0007 decision 1, pattern V1): revisions are immutable once saved;
// the form points at the one it publishes. A form is a draft until its first publication,
// then published; retiring it stops new submissions and keeps the pointer, so the revision it
// last served stays known. Publishing again (the same form, another revision) brings a retired
// form back.

export const FORM_STATUSES = ['draft', 'published', 'retired'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export type AlreadyPublished = { readonly code: 'forms.form.already-published' };
export type NotPublished = { readonly code: 'forms.form.not-published' };

export interface PublicationState {
  readonly status: FormStatus;
  readonly publishedRevisionId: Id<'FormRevision'> | null;
}

/** Publishing `revisionId`: any revision of the form but the one it serves now. */
export function planPublish(
  state: PublicationState,
  revisionId: Id<'FormRevision'>,
): Result<PublicationState, AlreadyPublished> {
  if (state.status === 'published' && state.publishedRevisionId === revisionId) {
    return err({ code: 'forms.form.already-published' });
  }
  return ok({ status: 'published', publishedRevisionId: revisionId });
}

/** Retiring: only a published form; the pointer stays. */
export function planRetire(state: PublicationState): Result<PublicationState, NotPublished> {
  if (state.status !== 'published') return err({ code: 'forms.form.not-published' });
  return ok({ status: 'retired', publishedRevisionId: state.publishedRevisionId });
}
