import type { IncidentKind } from './incident';

/**
 * The core's mirror of an engine user task (ADR-0005 decision 4). The engine decides that a
 * task exists and when it ends; the core decides who may act on it (slice 2.3) and records the
 * completion it asked for. Pure rules, no I/O.
 *
 *   open --(completion requested)--> completing --(the engine completed it with our key)--> completed
 *     |                                  +--(the engine removed it first: a deadline)--> superseded
 *     +--(the engine removed it: a boundary timer)--> escalated
 *     +--(the engine removed it: any other reason)--> cancelled
 *     +--(the engine completed it without the core)--> completed, with an incident
 */
export const TASK_STATUSES = [
  'open',
  'completing',
  'completed',
  'superseded',
  'escalated',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['open', 'completing'];

/** What the rules read of a task. */
export interface TaskState {
  readonly status: TaskStatus;
  readonly completionKey: string | null;
}

/** How the engine's history says a task ended. */
export type EngineTaskEnd =
  | { readonly kind: 'completed'; readonly completionKey: string | null }
  | { readonly kind: 'deleted'; readonly reason: string | null };

/** Flowable's delete reason of a task removed by an interrupting boundary event. */
const BOUNDARY_EVENT_REASON = 'boundary event';

/**
 * The status a task takes when the engine reports it ended, and the incident to record (PoC 3
 * R4, R7, R10); `null` when the task is closed already. The completion key tells the core's own
 * completion from anybody else's.
 */
export function statusOnEngineEnd(
  task: TaskState,
  end: EngineTaskEnd,
): { readonly status: TaskStatus; readonly incident: IncidentKind | null } | null {
  if (!OPEN_TASK_STATUSES.includes(task.status)) return null;
  if (end.kind === 'deleted') {
    // The engine removed it while the core's completion was on its way: the deadline won
    // (owner decision on PoC 3 R7). The request to complete is kept, marked superseded.
    if (task.status === 'completing') {
      return { status: 'superseded', incident: 'completion-superseded' };
    }
    const byTimer = end.reason !== null && end.reason.startsWith(BOUNDARY_EVENT_REASON);
    return { status: byTimer ? 'escalated' : 'cancelled', incident: null };
  }
  const ours =
    task.status === 'completing' &&
    task.completionKey !== null &&
    end.completionKey === task.completionKey;
  return { status: 'completed', incident: ours ? null : 'completed-outside-core' };
}

/** A completion may be asked for an open task only, once. */
export const canRequestCompletion = (task: TaskState): boolean => task.status === 'open';
