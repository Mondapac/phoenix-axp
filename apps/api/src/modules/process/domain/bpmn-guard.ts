import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

/**
 * The intake check of a BPMN model before it is stored and deployed (ADR-0005; security review
 * of slice 2.2). Flowable runs every tenant's models in one engine, and a model can run code
 * there: script tasks, Java delegates, listeners, and expressions (`${bean.method()}`) that call
 * methods. A model of one tenant must never reach the engine's process, its beans or another
 * tenant's data, so the core accepts only an allow-list of plain BPMN:
 *
 * - well-formed XML without a DOCTYPE, entity declarations or processing instructions other than
 *   the XML declaration;
 * - only the elements and attributes below, by local name, whatever the namespace prefix;
 * - expressions only as a whole value `${...}` of variables, literals and comparison or logic
 *   operators: no member access, call, index, assignment or lambda;
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
  'timeCycle',
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

/** A whole-value expression: `${` or `#{`, a body, `}`. */
const EXPRESSION = /^\s*[$#]\{([^{}]*)\}\s*$/;
/** A string literal of an expression: plain codes and words only. */
const EXPRESSION_STRING = /'[A-Za-z0-9 _.:-]*'|"[A-Za-z0-9 _.:-]*"/g;
/** The comparison and logic operators an expression may use. */
const EXPRESSION_OPERATOR = /==|!=|<=|>=|&&|\|\||[<>!]/g;
/** What may remain of an expression body once its literals and operators are blanked. */
const EXPRESSION_BODY = /^[A-Za-z0-9_\s]*$/;

/** Whether a text or attribute value is free of expressions, or is one safe expression. */
function valueAllowed(value: string): boolean {
  if (!/[$#]\{/.test(value)) return true;
  const expression = EXPRESSION.exec(value);
  if (expression === null) return false;
  const body = expression[1]!.replace(EXPRESSION_STRING, "''");
  return (
    body.trim().length > 0 &&
    EXPRESSION_BODY.test(body.replace(/''/g, ' ').replace(EXPRESSION_OPERATOR, ' '))
  );
}

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

  const open: string[] = [];
  const processes: ProcessSeen[] = [];
  let rootSeen = false;
  let at = 0;
  const declaration = XML_DECLARATION.exec(xml.replace(/^\uFEFF/, ''));
  if (declaration !== null) at = declaration[0].length + (xml.startsWith('\uFEFF') ? 1 : 0);

  while (at < xml.length) {
    const next = xml.indexOf('<', at);
    const textEnd = next === -1 ? xml.length : next;
    const text = decode(xml.slice(at, textEnd));
    if (text === null) return err(MALFORMED);
    if (text.trim().length > 0) {
      if (open.length === 0) return err(MALFORMED);
      if (!valueAllowed(text)) return forbidden('expression');
    }
    if (next === -1) break;
    at = next;
    const rest = xml.slice(at);

    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end === -1 || rest.slice(4, end).includes('--')) return err(MALFORMED);
      at += end + 3;
      continue;
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = rest.indexOf(']]>');
      if (end === -1 || open.length === 0) return err(MALFORMED);
      if (!valueAllowed(rest.slice(9, end))) return forbidden('expression');
      at += end + 3;
      continue;
    }
    // A DOCTYPE, an entity declaration or a processing instruction: never accepted.
    if (rest.startsWith('<!') || rest.startsWith('<?')) return forbidden('declaration');

    const end = END_TAG.exec(rest);
    if (end !== null) {
      if (open.pop() !== end[1]) return err(MALFORMED);
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
      attributes.set(attributeName, value);
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) continue;
      const local = localName(attributeName);
      if (!ALLOWED_ATTRIBUTES.has(local)) return forbidden(local);
      const fixed = FIXED_VALUES[local];
      if (fixed !== undefined && value !== fixed) return forbidden(local);
      if (!valueAllowed(value)) return forbidden('expression');
    }
    if (element === 'process') {
      processes.push({
        id: attributes.get('id') ?? null,
        executable: attributes.get('isExecutable') === 'true',
      });
    }
    if (selfClosing !== '/') open.push(name);
    at += whole.length;
  }
  if (!rootSeen || open.length > 0) return err(MALFORMED);

  const executable = processes.filter((process) => process.executable);
  if (executable.length !== 1 || executable[0]!.id !== processKey) {
    return err({ code: 'process.bpmn.process-key-mismatch' });
  }
  return ok(undefined);
}
