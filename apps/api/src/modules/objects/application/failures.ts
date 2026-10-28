import type { AlreadyPublished, NotPublished } from '../domain/lifecycle';
import type { InvalidRecord } from '../domain/record-values';
import type { InvalidValue } from '../domain/values';

// The expected failures of the objects use cases: codes, and for a value its field name, never
// the value itself. The controllers map each code to its HTTP status.

export type DefinitionNotFound = { readonly code: 'objects.definition.not-found' };
export type RevisionNotFound = { readonly code: 'objects.revision.not-found' };
export type SiteNotFound = { readonly code: 'objects.site.not-found' };
export type KeyTaken = { readonly code: 'objects.definition.key-taken' };
/** The previous revision changed while this one was being prepared: prepare it again. */
export type RevisionOutdated = { readonly code: 'objects.revision.outdated' };
/** Lowering a field's sensitivity needs `objects.definitions.lower-sensitivity`. */
export type LoweringDenied = { readonly code: 'objects.revision.lowering-denied' };
export type RecordNotFound = { readonly code: 'objects.record.not-found' };
/** A draft or retired definition takes no new record and no change. */
export type NotAccepting = { readonly code: 'objects.definition.not-accepting' };

export type { AlreadyPublished, InvalidRecord, InvalidValue, NotPublished };

export const DEFINITION_NOT_FOUND: DefinitionNotFound = Object.freeze({
  code: 'objects.definition.not-found',
});
export const REVISION_NOT_FOUND: RevisionNotFound = Object.freeze({
  code: 'objects.revision.not-found',
});
export const SITE_NOT_FOUND: SiteNotFound = Object.freeze({ code: 'objects.site.not-found' });
export const RECORD_NOT_FOUND: RecordNotFound = Object.freeze({ code: 'objects.record.not-found' });
export const NOT_ACCEPTING: NotAccepting = Object.freeze({
  code: 'objects.definition.not-accepting',
});
