/**
 * The core's task (ADR-0005 decision 4): one row per engine user task. The engine decides that
 * a task exists and when it ends; the core decides who may act on it and records what they
 * decided. Pure state rules, no I/O.
 *
 *   open --(assignee decides)--> completing --(engine completed it with our key)--> completed
 *     |                              |
 *     |                              +--(engine removed it first, e.g. the deadline)--> superseded
 *     +--(engine removed it: boundary timer)--> escalated
 *     +--(engine removed it: any other reason)--> cancelled
 *     +--(engine completed it without the core)--> completed + incident
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

export const DECISIONS = ['approve', 'reject'] as const;
export type Decision = (typeof DECISIONS)[number];

export const isDecision = (value: unknown): value is Decision =>
  typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);

/** What the state rules read of a task. */
export interface TaskState {
  readonly status: TaskStatus;
  readonly assigneeId: string;
  readonly completionKey: string | null;
}

/** How the engine says a task ended (its history record). */
export type EngineTaskEnd =
  | { readonly kind: 'completed'; readonly completionKey: string | null }
  | { readonly kind: 'deleted'; readonly reason: string | null };

/** Something the bridge saw that the design says cannot happen; recorded, never hidden. */
export type IncidentKind =
  'completed-outside-core' | 'completion-superseded' | 'orphan-instance' | 'unknown-request';

export type CompletionRefusal = 'task.not-found' | 'task.not-open';

/**
 * The assignee's decision. Another person's task answers "not found", never "forbidden"
 * (a permission never grants a resource; CLAUDE.md, authorisation).
 */
export function checkCompletion(task: TaskState, actorAccountId: string): CompletionRefusal | null {
  if (task.assigneeId !== actorAccountId) return 'task.not-found';
  if (task.status !== 'open') return 'task.not-open';
  return null;
}

/** The status a task takes when the engine reports it ended, and any incident to record. */
export function statusOnEngineEnd(
  task: TaskState,
  end: EngineTaskEnd,
): { readonly status: TaskStatus; readonly incident: IncidentKind | null } | null {
  if (task.status !== 'open' && task.status !== 'completing') return null; // already closed
  if (end.kind === 'deleted') {
    if (task.status === 'completing')
      return { status: 'superseded', incident: 'completion-superseded' };
    const byTimer = end.reason !== null && end.reason.startsWith('boundary event');
    return { status: byTimer ? 'escalated' : 'cancelled', incident: null };
  }
  const ours =
    task.status === 'completing' &&
    task.completionKey !== null &&
    end.completionKey === task.completionKey;
  return { status: 'completed', incident: ours ? null : 'completed-outside-core' };
}

export const OPEN_STATUSES: readonly TaskStatus[] = ['open', 'completing'];
