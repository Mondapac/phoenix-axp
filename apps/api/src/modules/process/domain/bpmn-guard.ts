import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

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
 * - element ids and form keys of plain characters, sized for the core's columns;
 * - a flow the engine cannot spin in: at most MAX_FLOW_NODES nodes, every loop passes a user
 *   task, and no repeating timer (one tenant's model must not hold the shared engine);
 * - exactly one executable process, whose id is the published process key.
 *
 * It is a scanner of the XML grammar, not a parser: anything it cannot read is refused. Pure,
 * no I/O.
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
  | { readonly code: 'process.bpmn.forbidden-construct'; readonly field: string };

const MALFORMED: BpmnRefusal = Object.freeze({ code: 'process.bpmn.malformed' });
const forbidden = (field: string): Result<never, BpmnRefusal> =>
  err({ code: 'process.bpmn.forbidden-construct', field: field.slice(0, 64) });

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

/** The most flow nodes a model may hold. */
export const MAX_FLOW_NODES = 500;

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
const textAllowed = (element: string, text: string): boolean =>
  EXPRESSION_ELEMENTS.has(element) ? valueAllowed(text) : !HAS_EXPRESSION.test(text);

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  quot: '"',
};

/** The text a parser sees: character and predefined references decoded; null if undefined. */
function decode(raw: string): string | null {
  let failed = false;
  const text = raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);|&/g, (all, ref) => {
    if (ref === undefined) {
      failed = true;
      return all;
    }
    const name = ref as string;
    if (name.startsWith('#')) {
      const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1));
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) {
        failed = true;
        return all;
      }
      return String.fromCodePoint(code);
    }
    const value = PREDEFINED[name];
    if (value === undefined) failed = true;
    return value ?? all;
  });
  return failed ? null : text;
}

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

const NAME = '[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
const START_TAG = new RegExp(
  `^<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`,
);
const END_TAG = new RegExp(`^</(${NAME})\\s*>`);
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g');
const XML_DECLARATION = /^<\?xml\s[^?]*\?>/;
/** XML 1.0, in UTF-8 when an encoding is named: the bytes the core checked are the engine's. */
const DECLARATION = new RegExp(
  `^<\\?xml\\s+version\\s*=\\s*(["'])1\\.0\\1(?:\\s+encoding\\s*=\\s*(["'])UTF-8\\2)?` +
    `(?:\\s+standalone\\s*=\\s*(["'])(?:yes|no)\\3)?\\s*\\?>$`,
  'i',
);

/** The flow nodes the loop check reads; a user task waits for a person. */
const FLOW_NODES: ReadonlySet<string> = new Set([
  'startEvent',
  'endEvent',
  'userTask',
  'manualTask',
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
 * Whether the flow cannot spin in the engine: within MAX_FLOW_NODES, and without its user tasks
 * the graph has no cycle (a loop through gateways, events or manual tasks runs without a wait
 * state, inside one engine transaction or as a busy timer). A user task waits for a person.
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
  for (const [boundary, host] of flow.attached) {
    if (!flow.nodes.has(boundary) || !flow.nodes.has(host)) return false;
  }
  const ready = [...flow.nodes.keys()].filter((id) => incoming.get(id) === 0);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop()!;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
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

/** The model as the core stores and deploys it, or why it is refused. */
export function checkBpmn(xml: string, processKey: string): Result<void, BpmnRefusal> {
  if (new TextEncoder().encode(xml).length > MAX_BPMN_BYTES) {
    return err({ code: 'process.bpmn.too-large' });
  }
  if (!PROCESS_KEY.test(processKey)) return err({ code: 'process.bpmn.process-key-mismatch' });

  const open: { readonly name: string; readonly element: string; text: string }[] = [];
  const processes: ProcessSeen[] = [];
  const flow: Flow = { nodes: new Map(), edges: [], attached: [] };
  let rootSeen = false;
  let at = 0;
  const body = xml.replace(/^\uFEFF/, '');
  const declaration = XML_DECLARATION.exec(body);
  if (declaration !== null) {
    if (!DECLARATION.test(declaration[0])) return forbidden('declaration');
    at = declaration[0].length + (xml.startsWith('\uFEFF') ? 1 : 0);
  }

  while (at < xml.length) {
    const next = xml.indexOf('<', at);
    const textEnd = next === -1 ? xml.length : next;
    const text = decode(xml.slice(at, textEnd));
    if (text === null) return err(MALFORMED);
    if (open.length === 0) {
      if (text.trim().length > 0) return err(MALFORMED);
    } else {
      open[open.length - 1]!.text += text;
    }
    if (next === -1) break;
    at = next;
    const rest = xml.slice(at);

    // A comment is dropped and CDATA joins the text around it, as the engine reads them: the
    // check judges the whole text of an element at its end tag, never one run.
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end === -1 || rest.slice(4, end).includes('--')) return err(MALFORMED);
      at += end + 3;
      continue;
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = rest.indexOf(']]>');
      if (end === -1 || open.length === 0) return err(MALFORMED);
      open[open.length - 1]!.text += rest.slice(9, end);
      at += end + 3;
      continue;
    }
    // A DOCTYPE, an entity declaration or a processing instruction: never accepted.
    if (rest.startsWith('<!') || rest.startsWith('<?')) return forbidden('declaration');

    const end = END_TAG.exec(rest);
    if (end !== null) {
      const closed = open.pop();
      if (closed === undefined || closed.name !== end[1]) return err(MALFORMED);
      if (!textAllowed(closed.element, closed.text)) return forbidden('expression');
      at += end[0].length;
      continue;
    }
    const start = START_TAG.exec(rest);
    if (start === null) return err(MALFORMED);
    const [whole, name, attributeText, selfClosing] = start as unknown as [
      string,
      string,
      string,
      string,
    ];
    if (open.length === 0 && rootSeen) return err(MALFORMED);
    rootSeen = true;
    const element = localName(name);
    if (!ALLOWED_ELEMENTS.has(element)) return forbidden(element);

    const attributes = new Map<string, string>();
    for (const attribute of attributeText.matchAll(ATTRIBUTE)) {
      const attributeName = attribute[1]!;
      const value = decode(attribute[2] ?? attribute[3] ?? '');
      if (value === null) return err(MALFORMED);
      if (attributes.has(attributeName)) return err(MALFORMED);
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) {
        attributes.set(attributeName, value);
        continue;
      }
      const local = localName(attributeName);
      if (!ALLOWED_ATTRIBUTES.has(local)) return forbidden(local);
      if (attributes.has(local)) return err(MALFORMED);
      attributes.set(local, value);
      const fixed = FIXED_VALUES[local];
      if (fixed !== undefined && value !== fixed) return forbidden(local);
      if (HAS_EXPRESSION.test(value)) return forbidden('expression');
      if (local === 'id' && !ELEMENT_ID.test(value)) return forbidden('id');
      if (local === 'formKey' && !FORM_KEY.test(value)) return forbidden('formKey');
    }
    const id = attributes.get('id');
    if (element === 'process') {
      processes.push({ id: id ?? null, executable: attributes.get('isExecutable') === 'true' });
    }
    if (FLOW_NODES.has(element)) {
      if (id === undefined || flow.nodes.has(id)) return err(MALFORMED);
      flow.nodes.set(id, element);
      const host = attributes.get('attachedToRef');
      if (element === 'boundaryEvent' && host !== undefined) flow.attached.push([id, host]);
    }
    if (element === 'sequenceFlow') {
      const source = attributes.get('sourceRef');
      const target = attributes.get('targetRef');
      if (source === undefined || target === undefined) return err(MALFORMED);
      flow.edges.push([source, target]);
    }
    if (selfClosing !== '/') open.push({ name, element, text: '' });
    at += whole.length;
  }
  if (!rootSeen || open.length > 0) return err(MALFORMED);

  const executable = processes.filter((process) => process.executable);
  if (executable.length !== 1 || executable[0]!.id !== processKey) {
    return err({ code: 'process.bpmn.process-key-mismatch' });
  }
  if (!flowBounded(flow)) return err({ code: 'process.bpmn.unbounded-flow' });
  return ok(undefined);
}
