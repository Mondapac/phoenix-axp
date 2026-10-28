import { err, ok } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';

// The life of an Object definition (ADR-0017 decision 2; ADR-0007 pattern V1), as for forms:
// revisions are immutable once saved; the definition points at the one it publishes. A
// definition is a draft until its first publication, then published; retiring it stops new
// records and keeps the pointer. Publishing again brings a retired definition back.

export const DEFINITION_STATUSES = ['draft', 'published', 'retired'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export type AlreadyPublished = { readonly code: 'objects.definition.already-published' };
export type NotPublished = { readonly code: 'objects.definition.not-published' };

export interface PublicationState {
  readonly status: DefinitionStatus;
  readonly publishedRevisionId: Id<'ObjectRevision'> | null;
}

/** Publishing `revisionId`: any revision of the definition but the one it serves now. */
export function planPublish(
  state: PublicationState,
  revisionId: Id<'ObjectRevision'>,
): Result<PublicationState, AlreadyPublished> {
  if (state.status === 'published' && state.publishedRevisionId === revisionId) {
    return err({ code: 'objects.definition.already-published' });
  }
  return ok({ status: 'published', publishedRevisionId: revisionId });
}

/** Retiring: only a published definition; the pointer stays. */
export function planRetire(state: PublicationState): Result<PublicationState, NotPublished> {
  if (state.status !== 'published') return err({ code: 'objects.definition.not-published' });
  return ok({ status: 'retired', publishedRevisionId: state.publishedRevisionId });
}
