import { defineEvent, eventField } from '@phoenix/shared-kernel';
import { DECISIONS } from './task';

/**
 * Core -> engine commands, written to `process.outbox` in the use case's transaction and
 * relayed to the engine by the worker (ADR-0005 decision 3). Closed field vocabulary: ids,
 * enums and integers, no free text, no personal data (ADR-0006 decision 2).
 */
export const requestSubmitted = defineEvent({
  type: 'process.request-submitted.v1',
  aggregateType: 'request',
  payload: {
    requestId: eventField.id(),
    processRevisionId: eventField.id(),
    approverId: eventField.id(),
    managerId: eventField.id(),
    escalateAfterSeconds: eventField.integer(),
  },
});

export const taskCompletionRequested = defineEvent({
  type: 'process.task-completion-requested.v1',
  aggregateType: 'task',
  payload: {
    taskId: eventField.id(),
    decision: eventField.enumOf(DECISIONS),
  },
});

export const PROCESS_EVENTS = [requestSubmitted, taskCompletionRequested] as const;
