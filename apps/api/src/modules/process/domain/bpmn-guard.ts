import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import {
  parseTaskSettings,
  TASK_SETTING_ATTRIBUTES,
  type InvalidTaskSetting,
  type TaskSettings,
} from './task-settings';
import { isScanFailure, localName, scanXml, type XmlStartTag } from './xml-scan';

/**
 * The intake check of a BPMN model before it is stored and deployed (ADR-0005; security review
 * of slice 2.2). Flowable runs every tenant's models in one engine, and a model can run code
 * there: script tasks, Java delegates, listeners, and expressions (`${bean.method()}`) that call
 * methods. A model of one tenant must never reach the engine's process, its beans or another
 * tenant's data, so the core accepts only an allow-list of plain BPMN:
 *
 * - well-formed XML 1.0 in UTF-8 without a DOCTYPE, entity declarations or processing
 *   instructions other than the XML declaration;
 * - only the elements and attributes below, by local name, whatever the namespace prefix;
 * - expressions only in a condition or a timer, judged on the element's whole text as the engine
 *   reads it (text and CDATA joined, comments dropped), as one `${...}` of variables, literals
 *   and comparison or logic operators: no member access, call, index, assignment, lambda or
 *   engine object; never in an attribute, a name or a form key;
 * - a timer duration is a literal ISO 8601 duration of at least MIN_TIMER_SECONDS, or one
 *   variable, whose value the core checks the same way (engine-command.ts);
 * - element ids and form keys of plain characters, sized for the core's columns; a form key in
 *   a namespace, on a start event or user task of the executable process, one start form;
 * - a flow the engine cannot spin in: at most MAX_FLOW_NODES nodes, every loop passes a user
 *   task (a boundary event of that task does not count as passing it), no repeating timer, at
 *   most MAX_TOKENS tokens reach a node between two waits for a person (gateways cannot
 *   multiply tokens without a loop), and no start event definition: only the core starts
 *   instances (one tenant's model must not hold the shared engine);
 * - exactly one executable process, whose id is the published process key;
 * - the core's own user task settings (task-settings.ts) on user tasks only, each valid;
 * - one kind of service task only, the engine's decision table task (`flowable:type="dmn"`,
 *   slice 2.7), whose fields are literals: the key of a decision table the tenant published
 *   (dmn-guard.ts) and whether no hit is an error. The engine finds the table by key in the
 *   instance's tenant only (never the default tenant), so another tenant's table never runs.
 *
 * It reads the XML through the scanner of xml-scan.ts: anything it cannot read is refused.
 * Pure, no I/O.
 */

/** The most a model may weigh, in UTF-8 bytes; the column CHECK repeats it. */
export const MAX_BPMN_BYTES = 1_048_576;

/** A process key: the BPMN process id, the engine's definition key. */
export const PROCESS_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export type BpmnRefusal =
  | { readonly code: 'process.bpmn.too-large' }
  | { readonly code: 'process.bpmn.malformed' }
  | { readonly code: 'process.bpmn.process-key-mismatch' }
  /** A loop without a user task, or more than MAX_FLOW_NODES nodes. */
  | { readonly code: 'process.bpmn.unbounded-flow' }
  /** `field` is the element or attribute name, or `expression`: never a value. */
  | { readonly code: 'process.bpmn.forbidden-construct'; readonly field: string }
  | InvalidTaskSetting;

/** Where a model names a form (slice 2.6): its start event, or a user task. */
export interface FormReference {
  readonly elementId: string;
  readonly kind: 'start' | 'task';
  /** The forms module's key of the form, as the model wrote it. */
  readonly formKey: string;
}

/** Where a model runs a decision table (slice 2.7): a decision task and the table's key. */
export interface DecisionReference {
  readonly elementId: string;
  readonly decisionKey: string;
}

/**
 * What the check read of an accepted model: the core's settings of each user task, by id, and
 * the forms its start event and user tasks name (at most one start form).
 */
export interface CheckedModel {
  readonly userTasks: ReadonlyMap<string, TaskSettings>;
  readonly forms: readonly FormReference[];
  readonly decisions: readonly DecisionReference[];
}

const MALFORMED: BpmnRefusal = Object.freeze({ code: 'process.bpmn.malformed' });
const refusal = (field: string): BpmnRefusal => ({
  code: 'process.bpmn.forbidden-construct',
  field: field.slice(0, 64),
});
const forbidden = (field: string): Result<never, BpmnRefusal> => err(refusal(field));

/** Elements of plain BPMN and its diagram interchange: no task that runs code. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'definitions',
  'process',
  'collaboration',
  'participant',
  'laneSet',
  'lane',
  'flowNodeRef',
  'childLaneSet',
  'startEvent',
  'endEvent',
  'userTask',
  'manualTask',
  'serviceTask',
  'extensionElements',
  'field',
  'string',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'sequenceFlow',
  'conditionExpression',
  'boundaryEvent',
  'intermediateCatchEvent',
  'timerEventDefinition',
  'timeDuration',
  'timeDate',
  'terminateEventDefinition',
  'incoming',
  'outgoing',
  'documentation',
  'textAnnotation',
  'text',
  'association',
  'group',
  'category',
  'categoryValue',
  'BPMNDiagram',
  'BPMNPlane',
  'BPMNShape',
  'BPMNEdge',
  'BPMNLabel',
  'BPMNLabelStyle',
  'Bounds',
  'Font',
  'waypoint',
]);

/** Attributes of those elements, layout included: no assignee, listener, class or script. */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'name',
  'isExecutable',
  'isClosed',
  'processType',
  'targetNamespace',
  'typeLanguage',
  'expressionLanguage',
  'exporter',
  'exporterVersion',
  'type',
  'processRef',
  'sourceRef',
  'targetRef',
  'attachedToRef',
  'cancelActivity',
  'default',
  'gatewayDirection',
  'formKey',
  'isInterrupting',
  'parallelMultiple',
  'isForCompensation',
  'startQuantity',
  'completionQuantity',
  'categoryValueRef',
  'value',
  'associationDirection',
  'textFormat',
  'bpmnElement',
  'sourceElement',
  'targetElement',
  'isHorizontal',
  'isExpanded',
  'isMarkerVisible',
  'labelStyle',
  'x',
  'y',
  'width',
  'height',
  'size',
  'isBold',
  'isItalic',
  'isUnderline',
  'isStrikeThrough',
  'stroke',
  'fill',
  'background-color',
  'border-color',
  'resolution',
  ...TASK_SETTING_ATTRIBUTES,
]);

/** Attributes whose value is fixed: another expression or type language could run a script. */
const FIXED_VALUES: Readonly<Record<string, string>> = {
  expressionLanguage: 'http://www.w3.org/1999/XPath',
  typeLanguage: 'http://www.w3.org/2001/XMLSchema',
};

/** The elements whose text the engine evaluates as an expression. */
const EXPRESSION_ELEMENTS: ReadonlySet<string> = new Set([
  'conditionExpression',
  'timeDuration',
  'timeDate',
]);

/** An element id: the engine's activity id and the core's task key. */
const ELEMENT_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
/** A form key: a literal reference the core resolves (slice 2.4). */
const FORM_KEY = /^[A-Za-z0-9_.:-]{1,128}$/;

/** A decision table's key: the DMN decision id, the engine's decision key (dmn-guard.ts). */
export const DECISION_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

const DECISION_KEY_FIELD = 'decisionTableReferenceKey';
const THROW_ON_NO_HITS_FIELD = 'decisionTaskThrowErrorOnNoHits';
/**
 * The fields a decision task may set. Not `fallbackToDefaultTenant` (another tenant's table),
 * `sameDeployment` (the core deploys tables on their own) or a decision service.
 */
const DECISION_FIELDS: ReadonlySet<string> = new Set([DECISION_KEY_FIELD, THROW_ON_NO_HITS_FIELD]);

/** The elements a decision task may hold, by parent: its fields, as literal strings. */
const DECISION_TASK_CHILDREN: Readonly<Record<string, ReadonlySet<string>>> = {
  serviceTask: new Set(['extensionElements', 'incoming', 'outgoing', 'documentation']),
  extensionElements: new Set(['field']),
  field: new Set(['string']),
  string: new Set(),
};
/** Where those elements may stand, and nowhere else. */
const DECISION_TASK_PARENTS: Readonly<Record<string, string>> = {
  extensionElements: 'serviceTask',
  field: 'extensionElements',
  string: 'field',
};

/** A service task the engine runs as a decision table task, by its own namespace's `type`. */
const isDecisionTask = (tag: XmlStartTag): boolean =>
  tag.attributes.some(
    ([name, value]) => name.includes(':') && localName(name) === 'type' && value === 'dmn',
  );

/** The most flow nodes a model may hold. */
export const MAX_FLOW_NODES = 500;

/**
 * The most tokens that may reach one node in one run of the engine between waits for a person
 * (security review of slice 2.2: fan-out). Counted as paths, so an exclusive split that joins
 * again counts both branches: about ten such diamonds in a row reach it.
 */
export const MAX_TOKENS = 1000;

/** The shortest timer duration (security review of slice 2.2): one minute. */
export const MIN_TIMER_SECONDS = 60;

/** An ISO 8601 duration as the engine reads it: `P[nY][nM][nW][nD][T[nH][nM][n[.n]S]]`. */
const ISO_DURATION =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/;

/**
 * The fewest seconds an ISO 8601 duration can last (a month counted as 28 days), or null when
 * `text` is not one.
 */
export function durationSeconds(text: string): number | null {
  const match = ISO_DURATION.exec(text);
  if (match === null || text === 'P' || text.endsWith('T')) return null;
  const [years, months, weeks, days, hours, minutes] = match
    .slice(1, 7)
    .map((part) => Number(part ?? 0)) as [number, number, number, number, number, number];
  const seconds = Number((match[7] ?? '0').replace(',', '.'));
  return (
    ((years * 365 + months * 28 + weeks * 7 + days) * 24 + hours) * 3600 + minutes * 60 + seconds
  );
}

/** A duration a timer may wait: at least MIN_TIMER_SECONDS. */
export const timerDurationAllowed = (text: string): boolean =>
  (durationSeconds(text) ?? -1) >= MIN_TIMER_SECONDS;

/** A timer duration that names one variable; the core checks the value it sends. */
const DURATION_VARIABLE = /^\s*\$\{\s*[a-z][A-Za-z0-9]{0,63}\s*\}\s*$/;

/** Names an expression must not read: the engine's own objects and the host's environment. */
const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'execution',
  'task',
  'variableContainer',
  'processInstance',
  'processEngineConfiguration',
  'processEngine',
  'authenticatedUserId',
  'systemEnvironment',
  'systemProperties',
  'environment',
  'applicationContext',
]);

const HAS_EXPRESSION = /[$#]\{/;

/** A whole-value expression: `${` or `#{`, a body, `}`. */
const EXPRESSION = /^\s*[$#]\{([^{}]*)\}\s*$/;
/** A string literal of an expression: plain codes and words only. */
const EXPRESSION_STRING = /'[A-Za-z0-9 _.:-]*'|"[A-Za-z0-9 _.:-]*"/g;
/** The comparison and logic operators an expression may use. */
const EXPRESSION_OPERATOR = /==|!=|<=|>=|&&|\|\||[<>!]/g;
/** What may remain of an expression body once its literals and operators are blanked. */
const EXPRESSION_BODY = /^[A-Za-z0-9_\s]*$/;

/** Whether a text is free of expressions, or is one safe expression. */
function valueAllowed(value: string): boolean {
  if (!HAS_EXPRESSION.test(value)) return true;
  const expression = EXPRESSION.exec(value);
  if (expression === null) return false;
  const body = expression[1]!.replace(EXPRESSION_STRING, ' ').replace(EXPRESSION_OPERATOR, ' ');
  if (body.trim().length === 0 || !EXPRESSION_BODY.test(body)) return false;
  return body.split(/\s+/).every((word) => !RESERVED_IDENTIFIERS.has(word));
}

/** Whether an element's whole text, as the engine reads it, is allowed there. */
function textAllowed(element: string, text: string): boolean {
  if (element === 'timeDuration') {
    return DURATION_VARIABLE.test(text) || timerDurationAllowed(text.trim());
  }
  return EXPRESSION_ELEMENTS.has(element) ? valueAllowed(text) : !HAS_EXPRESSION.test(text);
}

/** The flow nodes the loop check reads; a user task waits for a person. */
const FLOW_NODES: ReadonlySet<string> = new Set([
  'startEvent',
  'endEvent',
  'userTask',
  'manualTask',
  'serviceTask',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'boundaryEvent',
  'intermediateCatchEvent',
]);

interface Flow {
  readonly nodes: Map<string, string>;
  readonly edges: [string, string][];
  readonly attached: [string, string][];
}

/**
 * Whether the flow cannot spin in the engine: within MAX_FLOW_NODES, and without the flows out of
 * its user tasks the graph has no cycle (a loop through gateways, events or manual tasks runs
 * without a wait state, inside one engine transaction or as a busy timer). A user task waits
 * for a person; a boundary event on it does not. On that acyclic graph, no node may be reached
 * by more than MAX_TOKENS paths: a token leaves each start and each user task alone, and a
 * parallel or inclusive split copies it to every branch.
 */
function flowBounded(flow: Flow): boolean {
  if (flow.nodes.size > MAX_FLOW_NODES) return false;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const id of flow.nodes.keys()) incoming.set(id, 0);
  for (const [source, target] of flow.edges) {
    if (!flow.nodes.has(source) || !flow.nodes.has(target)) return false;
    if (flow.nodes.get(source) === 'userTask') continue;
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    incoming.set(target, incoming.get(target)! + 1);
  }
  // A boundary event fires while its host waits, without a person: its edge from the host stays.
  for (const [boundary, host] of flow.attached) {
    if (!flow.nodes.has(boundary) || !flow.nodes.has(host)) return false;
    outgoing.set(host, [...(outgoing.get(host) ?? []), boundary]);
    incoming.set(boundary, incoming.get(boundary)! + 1);
  }
  const ready = [...flow.nodes.keys()].filter((id) => incoming.get(id) === 0);
  // Tokens per node, counted as the paths that reach it; a node with no counted flow in (a
  // start, or one reached only from user tasks) holds one.
  const tokens = new Map<string, number>();
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop()!;
    visited += 1;
    const held = Math.max(tokens.get(id) ?? 0, 1);
    if (held > MAX_TOKENS) return false;
    for (const target of outgoing.get(id) ?? []) {
      tokens.set(target, (tokens.get(target) ?? 0) + held);
      const left = incoming.get(target)! - 1;
      incoming.set(target, left);
      if (left === 0) ready.push(target);
    }
  }
  // A node never freed lies on a cycle that no user task breaks.
  return visited === flow.nodes.size;
}

interface ProcessSeen {
  readonly id: string | null;
  readonly executable: boolean;
}

/** The decision task being read: its id and the fields its extension elements gave. */
interface DecisionTaskSeen {
  readonly id: string;
  readonly fields: Map<string, string>;
  field: string | null;
}

/** The model as the core stores and deploys it, or why it is refused. */
export function checkBpmn(xml: string, processKey: string): Result<CheckedModel, BpmnRefusal> {
  if (new TextEncoder().encode(xml).length > MAX_BPMN_BYTES) {
    return err({ code: 'process.bpmn.too-large' });
  }
  if (!PROCESS_KEY.test(processKey)) return err({ code: 'process.bpmn.process-key-mismatch' });

  const processes: ProcessSeen[] = [];
  const flow: Flow = { nodes: new Map(), edges: [], attached: [] };
  const userTasks = new Map<string, TaskSettings>();
  const forms: FormReference[] = [];
  const decisions: DecisionReference[] = [];
  let formOutsideRun = false;
  let decisionOutsideRun = false;
  let decisionTask: DecisionTaskSeen | null = null;

  const start = (tag: XmlStartTag): BpmnRefusal | null => {
    const { element, parent } = tag;
    if (!ALLOWED_ELEMENTS.has(element)) return refusal(element);
    // Only the core starts an instance, by its business key: a timer start event would have the
    // engine start instances on its own, outside the relay and its checks.
    if (parent === 'startEvent' && element.endsWith('EventDefinition')) {
      return refusal('startEvent');
    }
    // An expression is the element's text alone; the engine never reads one around a child.
    if (parent !== undefined && EXPRESSION_ELEMENTS.has(parent)) return refusal(element);
    // The decision task's own children, and only there (slice 2.7).
    const allowedChildren = DECISION_TASK_CHILDREN[parent ?? ''];
    if (allowedChildren !== undefined && !allowedChildren.has(element)) return refusal(element);
    const home = DECISION_TASK_PARENTS[element];
    if (home !== undefined && parent !== home) return refusal(element);
    // A service task runs what its type names: only the engine's decision table task is allowed.
    if (element === 'serviceTask' && !isDecisionTask(tag)) return refusal('serviceTask');

    const attributes = new Map<string, string>();
    for (const [attributeName, value] of tag.attributes) {
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) continue;
      const local = localName(attributeName);
      if (!ALLOWED_ATTRIBUTES.has(local)) return refusal(local);
      if (attributes.has(local)) return MALFORMED;
      attributes.set(local, value);
      const fixed = FIXED_VALUES[local];
      if (fixed !== undefined && value !== fixed) return refusal(local);
      if (HAS_EXPRESSION.test(value)) return refusal('expression');
      if (local === 'id' && !ELEMENT_ID.test(value)) return refusal('id');
      if (local === 'formKey' && !FORM_KEY.test(value)) return refusal('formKey');
      // The engine reads only its own namespace's formKey; an unprefixed one it ignores, and the
      // core would bind a form the engine never shows.
      if (local === 'formKey' && !attributeName.includes(':')) return refusal('formKey');
      if (TASK_SETTING_ATTRIBUTES.has(local) && element !== 'userTask') return refusal(local);
      // The BPMN schema admits a foreign attribute only in a namespace of its own: the engine
      // refuses an unprefixed one at deployment, so the publication refuses it first.
      if (TASK_SETTING_ATTRIBUTES.has(local) && !attributeName.includes(':')) {
        return { code: 'process.bpmn.task-setting-invalid', field: local };
      }
    }
    const id = attributes.get('id');
    if (element === 'process') {
      processes.push({ id: id ?? null, executable: attributes.get('isExecutable') === 'true' });
    }
    if (FLOW_NODES.has(element)) {
      if (id === undefined || flow.nodes.has(id)) return MALFORMED;
      flow.nodes.set(id, element);
      const host = attributes.get('attachedToRef');
      if (element === 'boundaryEvent' && host !== undefined) flow.attached.push([id, host]);
      if (element === 'serviceTask' && processes.at(-1)?.executable !== true) {
        decisionOutsideRun = true;
      }
    }
    const formKey = attributes.get('formKey');
    if (formKey !== undefined) {
      // A form starts the process or shows on a task; anywhere else the core would not read it.
      const kind = element === 'startEvent' ? 'start' : element === 'userTask' ? 'task' : null;
      if (kind === null) return refusal('formKey');
      if (kind === 'start' && forms.some((form) => form.kind === 'start')) {
        return refusal('formKey');
      }
      if (processes.at(-1)?.executable !== true) formOutsideRun = true;
      forms.push({ elementId: id!, kind, formKey });
    }
    if (element === 'userTask') {
      const settings = parseTaskSettings(attributes);
      if (!settings.ok) return settings.error;
      userTasks.set(id!, settings.value);
    }
    if (element === 'serviceTask') decisionTask = { id: id!, fields: new Map(), field: null };
    if (element === 'field') {
      const name = attributes.get('name');
      if (name === undefined || decisionTask === null) return MALFORMED;
      if (!DECISION_FIELDS.has(name)) return refusal('field');
      if (decisionTask.fields.has(name)) return MALFORMED;
      decisionTask.field = name;
    }
    if (element === 'sequenceFlow') {
      const source = attributes.get('sourceRef');
      const target = attributes.get('targetRef');
      if (source === undefined || target === undefined) return MALFORMED;
      flow.edges.push([source, target]);
    }
    return null;
  };

  const end = (element: string, text: string): BpmnRefusal | null => {
    if (!textAllowed(element, text)) {
      return refusal(element === 'timeDuration' ? 'timeDuration' : 'expression');
    }
    if (element === 'string') {
      // A field's literal value, once; anything else in a field the engine would not read.
      const field = decisionTask?.field ?? null;
      if (decisionTask === null || field === null || decisionTask.fields.has(field)) {
        return MALFORMED;
      }
      decisionTask.fields.set(field, text.trim());
    }
    if (element === 'field' && decisionTask !== null) {
      if (decisionTask.field === null || !decisionTask.fields.has(decisionTask.field)) {
        return refusal('field');
      }
      decisionTask.field = null;
    }
    if (element === 'serviceTask' && decisionTask !== null) {
      const { id, fields } = decisionTask;
      decisionTask = null;
      const decisionKey = fields.get(DECISION_KEY_FIELD);
      if (decisionKey === undefined || !DECISION_KEY.test(decisionKey)) {
        return refusal(DECISION_KEY_FIELD);
      }
      const onNoHits = fields.get(THROW_ON_NO_HITS_FIELD);
      if (onNoHits !== undefined && onNoHits !== 'true' && onNoHits !== 'false') {
        return refusal(THROW_ON_NO_HITS_FIELD);
      }
      decisions.push({ elementId: id, decisionKey });
    }
    return null;
  };

  const scanned = scanXml(xml, { start, end });
  if (scanned !== null) {
    if (!isScanFailure(scanned)) return err(scanned);
    return scanned.kind === 'malformed' ? err(MALFORMED) : forbidden('declaration');
  }

  const executable = processes.filter((process) => process.executable);
  if (executable.length !== 1 || executable[0]!.id !== processKey) {
    return err({ code: 'process.bpmn.process-key-mismatch' });
  }
  // Only the executable process runs: a form or decision in another process would bind for
  // nothing.
  if (formOutsideRun) return forbidden('formKey');
  if (decisionOutsideRun) return forbidden('serviceTask');
  if (!flowBounded(flow)) return err({ code: 'process.bpmn.unbounded-flow' });
  return ok({ userTasks, forms, decisions });
}
