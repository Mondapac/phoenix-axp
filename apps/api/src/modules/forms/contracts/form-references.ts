import type { AccessDenied } from '../../../platform/authz';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';

/** A published form as another module may pin it: its key, id and published revision. */
export interface PublishedFormReference {
  readonly key: string;
  readonly formId: Id<'Form'>;
  readonly revisionId: Id<'FormRevision'>;
}

/** The most keys one call resolves. */
export const MAX_FORM_REFERENCES = 64;

/**
 * The forms facade for references by key (ADR-0001; slice 2.6: a process revision pins the
 * forms its model names). An in-process read, as the caller: only the forms the caller's
 * `forms.forms.view` grants reach are answered; a key that names no reachable published form
 * is left out of the answer, as if it did not exist. `startKey`, the form that would start a
 * process, is answered only where the caller also holds `forms.forms.publish`. Never call it
 * inside a unit.
 */
export interface FormReferences {
  published(
    context: CallContext,
    keys: readonly string[],
    startKey?: string,
  ): Promise<Result<readonly PublishedFormReference[], AccessDenied>>;
}

/** Nest token of the {@link FormReferences} facade, exported by the forms module. */
export const FORM_REFERENCES = Symbol('FORM_REFERENCES');
