// The view of the process API on the modeler and task screens: the shapes the API answers and
// the pure rules of the modeler's settings. The API decides (modules/process/domain/
// task-settings.ts and bpmn-guard.ts); these mirror its rules so the screens offer only what it
// accepts. Shared by server and client modules.

/** A process key: the BPMN process id (bpmn-guard PROCESS_KEY). */
export const PROCESS_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
export const isProcessKey = (text: string): boolean => PROCESS_KEY.test(text);

/** The namespace of the core's own user task settings in a model (slice 2.3). */
export const PHOENIX_NAMESPACE = 'urn:phoenix:bpmn';
/** The engine's namespace, for `flowable:formKey`. */
export const FLOWABLE_NAMESPACE = 'http://flowable.org/bpmn';
/** The engine variable an outcome reaches a gateway as. */
export const OUTCOME_VARIABLE = 'phoenixOutcome';

export interface DefinitionSummary {
  readonly processKey: string;
  readonly draft: { readonly version: number; readonly updatedAt: string } | null;
  readonly published: { readonly revision: number; readonly publishedAt: string } | null;
}

export interface ProcessDefinition {
  readonly processKey: string;
  readonly draft: {
    readonly version: number;
    readonly updatedAt: string;
    readonly bpmnXml: string;
  } | null;
  readonly published: {
    readonly id: string;
    readonly revision: number;
    readonly publishedAt: string;
    readonly bpmnXml: string;
  } | null;
}

/** A task as the inbox API answers it (GET process/tasks). Ids, codes and times only. */
export interface InboxTask {
  readonly id: string;
  readonly instanceId: string;
  readonly taskKey: string;
  readonly name: string | null;
  readonly formKey: string | null;
  readonly formRevisionId: string | null;
  readonly status: 'open' | 'completing' | 'completed' | 'superseded' | 'escalated' | 'cancelled';
  readonly siteId: string | null;
  readonly queueRoleId: string | null;
  readonly assigneeAccountId: string | null;
  readonly dueAt: string | null;
  readonly overdue: boolean;
  readonly escalatedAt: string | null;
  readonly outcomes: readonly string[];
  readonly version: number;
}

/** Where a task stands for the reader, which picks its badge and what it offers. */
export type TaskStanding = 'mine' | 'queue' | 'unassigned' | 'other' | 'completing' | 'closed';

export function standingOf(task: InboxTask, accountId: string): TaskStanding {
  if (task.status === 'completing') return 'completing';
  if (task.status !== 'open') return 'closed';
  if (task.assigneeAccountId === accountId) return 'mine';
  if (task.assigneeAccountId !== null) return 'other';
  return task.queueRoleId === null ? 'unassigned' : 'queue';
}

// ---- User task settings (task-settings.ts) ----

export const MAX_OUTCOMES = 8;
const OUTCOME = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_DEADLINE_DAYS = 365;
export const MAX_DEADLINE_HOURS = 720;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type Assignment =
  | { readonly kind: 'role'; readonly roleId: string | null }
  | { readonly kind: 'person'; readonly accountId: string | null }
  | { readonly kind: 'supervisor' };

export interface Deadline {
  readonly amount: number;
  readonly unit: 'days' | 'hours';
  /** Hours count on the clock only; days on the calendar or on working days (D4). */
  readonly count: 'calendar' | 'working';
}

/** The settings of one user task as the side panel edits them. */
export interface TaskSettingsForm {
  readonly assignment: Assignment;
  readonly deadline: Deadline | null;
  readonly escalationRoleId: string | null;
  readonly outcomes: readonly string[];
}

/** The model attributes of the core's settings, by local name (`phoenix:` prefix in the XML). */
export type TaskAttributeName =
  | 'phoenixRole'
  | 'phoenixAssignee'
  | 'phoenixDue'
  | 'phoenixDueDays'
  | 'phoenixEscalationRole'
  | 'phoenixOutcomes';
export type TaskAttributes = Partial<Record<TaskAttributeName, string>>;

const DURATION = /^P(?:([1-9][0-9]{0,2})D|T([1-9][0-9]{0,2})H)$/;

export function parseDeadline(due: string | undefined, count: string | undefined): Deadline | null {
  if (due === undefined) return null;
  const match = DURATION.exec(due);
  if (match === null) return null;
  if (match[1] !== undefined) {
    const amount = Number(match[1]);
    if (amount > MAX_DEADLINE_DAYS) return null;
    return { amount, unit: 'days', count: count === 'working' ? 'working' : 'calendar' };
  }
  const amount = Number(match[2]);
  return amount > MAX_DEADLINE_HOURS ? null : { amount, unit: 'hours', count: 'calendar' };
}

export const durationOf = (deadline: Deadline): string =>
  deadline.unit === 'days' ? `P${deadline.amount}D` : `PT${deadline.amount}H`;

/** The outcome codes of a comma-separated list, trimmed, empty parts dropped. */
export const outcomesOf = (text: string | undefined): string[] =>
  (text ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0);

export function settingsOf(attributes: TaskAttributes): TaskSettingsForm {
  const assignment: Assignment =
    attributes.phoenixAssignee !== undefined
      ? { kind: 'person', accountId: attributes.phoenixAssignee }
      : attributes.phoenixRole !== undefined
        ? { kind: 'role', roleId: attributes.phoenixRole }
        : { kind: 'supervisor' };
  return {
    assignment,
    deadline: parseDeadline(attributes.phoenixDue, attributes.phoenixDueDays),
    escalationRoleId: attributes.phoenixEscalationRole ?? null,
    outcomes: outcomesOf(attributes.phoenixOutcomes),
  };
}

/**
 * Every attribute of the settings, `undefined` for one to remove: what the modeler writes on
 * the task. An escalation needs a deadline, so it is dropped without one.
 */
export type TaskAttributeChanges = Record<TaskAttributeName, string | undefined>;

export function attributesOf(settings: TaskSettingsForm): TaskAttributeChanges {
  const { assignment, deadline } = settings;
  return {
    phoenixRole: assignment.kind === 'role' ? (assignment.roleId ?? undefined) : undefined,
    phoenixAssignee: assignment.kind === 'person' ? (assignment.accountId ?? undefined) : undefined,
    phoenixDue: deadline === null ? undefined : durationOf(deadline),
    phoenixDueDays: deadline === null ? undefined : deadline.count,
    phoenixEscalationRole: deadline === null ? undefined : (settings.escalationRoleId ?? undefined),
    phoenixOutcomes: settings.outcomes.length === 0 ? undefined : settings.outcomes.join(','),
  };
}

export type SettingsProblem =
  | 'role-missing'
  | 'person-missing'
  | 'deadline-invalid'
  | 'escalation-invalid'
  | 'outcome-invalid'
  | 'outcome-repeated'
  | 'outcomes-too-many';

/** What the API would refuse in a task's settings; empty when it accepts them. */
export function settingsProblems(settings: TaskSettingsForm): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const { assignment, deadline, outcomes } = settings;
  if (assignment.kind === 'role' && !isId(assignment.roleId)) problems.push('role-missing');
  if (assignment.kind === 'person' && !isId(assignment.accountId)) problems.push('person-missing');
  if (
    deadline !== null &&
    (!Number.isInteger(deadline.amount) ||
      deadline.amount < 1 ||
      deadline.amount > (deadline.unit === 'days' ? MAX_DEADLINE_DAYS : MAX_DEADLINE_HOURS) ||
      (deadline.unit === 'hours' && deadline.count === 'working'))
  ) {
    problems.push('deadline-invalid');
  }
  if (deadline !== null && settings.escalationRoleId !== null && !isId(settings.escalationRoleId)) {
    problems.push('escalation-invalid');
  }
  if (outcomes.some((code) => !OUTCOME.test(code))) problems.push('outcome-invalid');
  if (new Set(outcomes).size !== outcomes.length) problems.push('outcome-repeated');
  if (outcomes.length > MAX_OUTCOMES) problems.push('outcomes-too-many');
  return problems;
}

const isId = (value: string | null): boolean => value !== null && UUID_V7.test(value);
export const isOutcomeCode = (text: string): boolean => OUTCOME.test(text);

// ---- Conditions and timers (bpmn-guard: a condition is one `${...}` of variables and literals) ----

/** The condition of a flow taken when a task's outcome is `code`. */
export const outcomeCondition = (code: string): string => `\${${OUTCOME_VARIABLE} == '${code}'}`;

/** The outcome code of a condition the modeler wrote, or null for any other condition. */
export function outcomeOfCondition(condition: string | undefined): string | null {
  const match = /^\$\{phoenixOutcome == '([a-z][a-z0-9-]{0,31})'\}$/.exec(condition?.trim() ?? '');
  return match?.[1] ?? null;
}

export interface Wait {
  readonly amount: number;
  readonly unit: 'minutes' | 'hours' | 'days';
}

/** A timer's literal duration; the engine waits at least a minute (bpmn-guard MIN_TIMER_SECONDS). */
export const timerDurationOf = (wait: Wait): string =>
  wait.unit === 'days'
    ? `P${wait.amount}D`
    : wait.unit === 'hours'
      ? `PT${wait.amount}H`
      : `PT${wait.amount}M`;

export function parseTimerDuration(text: string | undefined): Wait | null {
  const match = /^P(?:([1-9][0-9]{0,3})D|T(?:([1-9][0-9]{0,3})H|([1-9][0-9]{0,4})M))$/.exec(
    text?.trim() ?? '',
  );
  if (match === null) return null;
  if (match[1] !== undefined) return { amount: Number(match[1]), unit: 'days' };
  if (match[2] !== undefined) return { amount: Number(match[2]), unit: 'hours' };
  return { amount: Number(match[3]), unit: 'minutes' };
}

// ---- A new model ----

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The model a new process key starts from: a start event, one user task and an end event. */
export function starterModel(key: string, name: string, taskName: string): string {
  if (!isProcessKey(key)) throw new Error('not a process key');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:phoenix="${PHOENIX_NAMESPACE}" xmlns:flowable="${FLOWABLE_NAMESPACE}" id="definitions" targetNamespace="${PHOENIX_NAMESPACE}">
  <bpmn:process id="${key}" name="${escapeXml(name)}" isExecutable="true">
    <bpmn:startEvent id="start">
      <bpmn:outgoing>flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="task_1" name="${escapeXml(taskName)}">
      <bpmn:incoming>flow_1</bpmn:incoming>
      <bpmn:outgoing>flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="end">
      <bpmn:incoming>flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start" targetRef="task_1" />
    <bpmn:sequenceFlow id="flow_2" sourceRef="task_1" targetRef="end" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="diagram">
    <bpmndi:BPMNPlane id="plane" bpmnElement="${key}">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task_1_di" bpmnElement="task_1">
        <dc:Bounds x="240" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_di" bpmnElement="end">
        <dc:Bounds x="392" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="flow_1_di" bpmnElement="flow_1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="240" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="flow_2_di" bpmnElement="flow_2">
        <di:waypoint x="340" y="120" />
        <di:waypoint x="392" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/** The API's most tasks for one inbox read (MAX_INBOX_TASKS): a larger limit answers 400. */
export const INBOX_LIMIT = 100;

/** The inbox read of the member's own tasks, or of the sites it supervises. */
export const inboxPath = (supervised: boolean): string =>
  `${supervised ? 'process/tasks/supervised' : 'process/tasks'}?limit=${INBOX_LIMIT}`;

/**
 * The size of the request that saves or publishes a model, as the API weighs it: the UTF-8
 * bytes of its JSON body (escaped quotes and line breaks included), whose limit is 64 KiB.
 */
export const modelBytes = (xml: string): number =>
  new TextEncoder().encode(JSON.stringify({ bpmnXml: xml, version: 2_147_483_647 })).length;
export const MAX_REQUEST_MODEL_BYTES = 63 * 1024;
