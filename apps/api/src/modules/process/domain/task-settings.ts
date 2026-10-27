import { err, ok, parseId } from '@phoenix/shared-kernel';
import type { Id, Result } from '@phoenix/shared-kernel';
import { DEADLINE_COUNTS, durationOf, parseDeadline, type Deadline } from './deadline';

/**
 * What the modeller sets on a user task (ADR-0025; owner decisions D3 and D4), as attributes
 * of the `userTask` element, read by local name like every attribute of the BPMN intake check:
 *
 * - `phoenixRole`: a role id; the task waits in that role's queue at the instance's site, and
 *   one holder claims it (the default of D3);
 * - `phoenixAssignee`: an account id; the task goes straight to that person (D3);
 * - `phoenixDue` and `phoenixDueDays`: the deadline, `P<n>D` or `PT<n>H`, counted in calendar
 *   or working days (D4);
 * - `phoenixEscalationRole`: a role id; when the deadline passes the task moves to that role's
 *   queue at the same site (the review's "the task reaches the manager");
 * - `phoenixOutcomes`: the codes a person picks from on completion, comma-separated; the engine
 *   receives the pick as `phoenixOutcome`.
 *
 * Flowable ignores them: the core reads them at publication and applies them itself. Pure.
 */
export const TASK_SETTING_ATTRIBUTES: ReadonlySet<string> = new Set([
  'phoenixRole',
  'phoenixAssignee',
  'phoenixDue',
  'phoenixDueDays',
  'phoenixEscalationRole',
  'phoenixOutcomes',
]);

export interface TaskSettings {
  /** The task's label in the inbox: the `name` of the user task, the tenant's text. */
  readonly name: string | null;
  readonly candidateRoleId: Id<'Role'> | null;
  readonly assigneeAccountId: Id<'Account'> | null;
  readonly deadline: Deadline | null;
  readonly escalationRoleId: Id<'Role'> | null;
  readonly outcomes: readonly string[];
}

export const NO_TASK_SETTINGS: TaskSettings = Object.freeze({
  name: null,
  candidateRoleId: null,
  assigneeAccountId: null,
  deadline: null,
  escalationRoleId: null,
  outcomes: Object.freeze([]),
});

/** An outcome code: what a gateway condition compares `phoenixOutcome` with. */
const OUTCOME = /^[a-z][a-z0-9-]{0,31}$/;
/** The engine variable that carries the outcome; the core's own, set by the bridge only. */
export const OUTCOME_VARIABLE = 'phoenixOutcome';

/** `value` as an outcome code, or null when it is not one. */
export const outcomeOf = (value: unknown): string | null =>
  typeof value === 'string' && OUTCOME.test(value) ? value : null;
export const MAX_OUTCOMES = 8;
/** The longest task name the inbox shows, in characters; the column CHECK repeats it. */
export const MAX_TASK_NAME = 255;

export type InvalidTaskSetting = {
  readonly code: 'process.bpmn.task-setting-invalid';
  /** The attribute's local name: never its value. */
  readonly field: string;
};

const invalid = (field: string): Result<never, InvalidTaskSetting> =>
  err({ code: 'process.bpmn.task-setting-invalid', field });

/**
 * The settings of one user task from its attributes (local name to decoded value). A task may
 * name a role or an assignee, not both; one with neither waits for a supervisor to assign it.
 * Days counting, an escalation role, need a deadline.
 */
export function parseTaskSettings(
  attributes: ReadonlyMap<string, string>,
): Result<TaskSettings, InvalidTaskSetting> {
  const name = attributes.get('name')?.trim() ?? '';
  if ([...name].length > MAX_TASK_NAME) return invalid('name');

  const role = attributes.get('phoenixRole');
  const assignee = attributes.get('phoenixAssignee');
  if (role !== undefined && assignee !== undefined) return invalid('phoenixAssignee');
  const candidateRoleId = role === undefined ? null : parseId<'Role'>(role);
  if (candidateRoleId !== null && !candidateRoleId.ok) return invalid('phoenixRole');
  const assigneeAccountId = assignee === undefined ? null : parseId<'Account'>(assignee);
  if (assigneeAccountId !== null && !assigneeAccountId.ok) return invalid('phoenixAssignee');

  const due = attributes.get('phoenixDue');
  const count = attributes.get('phoenixDueDays');
  if (count !== undefined && !(DEADLINE_COUNTS as readonly string[]).includes(count)) {
    return invalid('phoenixDueDays');
  }
  const deadline = due === undefined ? null : parseDeadline(due, count);
  if (due !== undefined && deadline === null) return invalid('phoenixDue');
  if (due === undefined && count !== undefined) return invalid('phoenixDueDays');

  const escalation = attributes.get('phoenixEscalationRole');
  const escalationRoleId = escalation === undefined ? null : parseId<'Role'>(escalation);
  if (escalationRoleId !== null && (!escalationRoleId.ok || deadline === null)) {
    return invalid('phoenixEscalationRole');
  }

  const listed = attributes.get('phoenixOutcomes');
  const outcomes = listed === undefined ? [] : listed.split(',').map((code) => code.trim());
  if (
    outcomes.length > MAX_OUTCOMES ||
    new Set(outcomes).size !== outcomes.length ||
    outcomes.some((code) => !OUTCOME.test(code))
  ) {
    return invalid('phoenixOutcomes');
  }

  return ok({
    name: name.length === 0 ? null : name,
    candidateRoleId: candidateRoleId?.ok ? candidateRoleId.value : null,
    assigneeAccountId: assigneeAccountId?.ok ? assigneeAccountId.value : null,
    deadline,
    escalationRoleId: escalationRoleId?.ok ? escalationRoleId.value : null,
    outcomes,
  });
}

/**
 * The attributes that give `settings` back through {@link parseTaskSettings}: how a revision
 * stores them, so a stored row is checked again when it is read (data, not trust).
 */
export function attributesOf(settings: TaskSettings): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (settings.name !== null) attributes.name = settings.name;
  if (settings.candidateRoleId !== null) attributes.phoenixRole = settings.candidateRoleId;
  if (settings.assigneeAccountId !== null) attributes.phoenixAssignee = settings.assigneeAccountId;
  if (settings.deadline !== null) {
    attributes.phoenixDue = durationOf(settings.deadline);
    attributes.phoenixDueDays = settings.deadline.count;
  }
  if (settings.escalationRoleId !== null) {
    attributes.phoenixEscalationRole = settings.escalationRoleId;
  }
  if (settings.outcomes.length > 0) attributes.phoenixOutcomes = settings.outcomes.join(',');
  return attributes;
}

/** Whether `outcome` completes a task offering `outcomes`: one of them, or none when it offers none. */
export const outcomeAccepted = (outcomes: readonly string[], outcome: string | null): boolean =>
  outcomes.length === 0 ? outcome === null : outcome !== null && outcomes.includes(outcome);
