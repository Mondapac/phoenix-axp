import type { InvalidSchema } from '../domain/form-schema';
import type { AlreadyPublished, NotPublished } from '../domain/lifecycle';
import type { InvalidValue } from '../domain/values';

// The expected failures of the forms use cases: codes, and for a value its field name, never
// the value itself. The controllers map each code to its HTTP status.

export type FormNotFound = { readonly code: 'forms.form.not-found' };
export type FormRevisionNotFound = { readonly code: 'forms.form-revision.not-found' };
export type SiteNotFound = { readonly code: 'forms.site.not-found' };
export type KeyTaken = { readonly code: 'forms.form.key-taken' };

export type { AlreadyPublished, InvalidSchema, InvalidValue, NotPublished };

export const FORM_NOT_FOUND: FormNotFound = Object.freeze({ code: 'forms.form.not-found' });
export const FORM_REVISION_NOT_FOUND: FormRevisionNotFound = Object.freeze({
  code: 'forms.form-revision.not-found',
});
export const SITE_NOT_FOUND: SiteNotFound = Object.freeze({ code: 'forms.site.not-found' });
