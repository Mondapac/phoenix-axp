import type { BpmnRefusal } from '../domain/bpmn-guard';

// The expected failures of the process use cases: codes and a field name, never values. The
// controllers map each code to its HTTP status.

export type RevisionNotFound = { readonly code: 'process.revision.not-found' };
/** A variable the engine must not receive (ADR-0005 decision 7); `field` is its name. */
export type InvalidVariable = { readonly code: 'process.variable.invalid'; readonly field: string };

export type { BpmnRefusal };

export const REVISION_NOT_FOUND: RevisionNotFound = Object.freeze({
  code: 'process.revision.not-found',
});
