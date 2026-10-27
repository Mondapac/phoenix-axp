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

/** No such task, or one the caller may not see (another site's or queue's). */
export type TaskNotFound = { readonly code: 'process.task.not-found' };
/** The caller sees the task but cannot do this now: held by another, closed, or its deadline won. */
export type TaskUnavailable = { readonly code: 'process.task.unavailable' };
/** The outcome is not one the task offers; `field` is `outcome`. */
export type InvalidOutcome = {
  readonly code: 'process.task.outcome-invalid';
  readonly field: 'outcome';
};
/** The account may not be given the task: not active, or without the queue's role or the work key at its site. */
export type IneligibleAssignee = {
  readonly code: 'process.task.assignee-ineligible';
  readonly field: 'accountId';
};

export const TASK_NOT_FOUND: TaskNotFound = Object.freeze({ code: 'process.task.not-found' });
export const TASK_UNAVAILABLE: TaskUnavailable = Object.freeze({
  code: 'process.task.unavailable',
});
export const INVALID_OUTCOME: InvalidOutcome = Object.freeze({
  code: 'process.task.outcome-invalid',
  field: 'outcome',
});
export const INELIGIBLE_ASSIGNEE: IneligibleAssignee = Object.freeze({
  code: 'process.task.assignee-ineligible',
  field: 'accountId',
});
