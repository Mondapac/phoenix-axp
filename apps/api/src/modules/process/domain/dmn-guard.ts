import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import { DECISION_KEY, RESERVED_DECISION_PREFIX } from './bpmn-guard';
import { RESERVED_VARIABLE_PREFIX } from './engine-command';
import { isScanFailure, localName, scanXml, type XmlStartTag } from './xml-scan';

/**
 * The intake check of a DMN decision table before it is stored and deployed (slice 2.7; the
 * security reasoning of bpmn-guard.ts). The engine evaluates a table's cells as expressions in
 * its shared process, so the core accepts only a plain decision table of literals:
 *
 * - XML as xml-scan.ts reads it; only the elements and attributes below, by local name;
 * - exactly one decision, whose id is the published decision key, holding one decision table
 *   with the hit policy UNIQUE, FIRST or ANY, and no expression or type language of its own;
 * - each input reads one variable by name (`days`), never an engine object;
 * - each input entry is empty or `-` (any value), or one comparison with a literal: `> 5`,
 *   `== "annual"`, `"annual"` (equal), `!= true`; each output entry is one literal;
 * - a literal is a number, `true`, `false`, or a quoted code of plain characters, like the
 *   variables the core sends (engine-command.ts): no free text or personal data;
 * - each output names the process variable it sets: never one of the core's own;
 * - no expression syntax (`${`, `#{`) anywhere; at most MAX_DMN_RULES rules, MAX_DMN_COLUMNS
 *   inputs and outputs and MAX_DMN_CELLS cells, each rule with one entry per column;
 * - an input may read a core variable (`phoenixOutcome`, the person's decision): read only;
 * - the key never starts with the core's variable prefix.
 *
 * Pure, no I/O.
 */

/** The most a decision table may weigh, in UTF-8 bytes; the column CHECK repeats it. */
export const MAX_DMN_BYTES = 262_144;
export const MAX_DMN_RULES = 500;
export const MAX_DMN_COLUMNS = 16;
/** The most cells (rules × columns) one table may hold: the engine evaluates each per decision. */
export const MAX_DMN_CELLS = 2000;

export type DmnRefusal =
  | { readonly code: 'process.dmn.too-large' }
  | { readonly code: 'process.dmn.malformed' }
  | { readonly code: 'process.dmn.decision-key-mismatch' }
  /** `field` is the element or attribute name, or `expression`: never a value. */
  | { readonly code: 'process.dmn.forbidden-construct'; readonly field: string };

/** What the check read of an accepted table: the variables it reads and the ones it sets. */
export interface CheckedDecision {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

const MALFORMED: DmnRefusal = Object.freeze({ code: 'process.dmn.malformed' });
const refusal = (field: string): DmnRefusal => ({
  code: 'process.dmn.forbidden-construct',
  field: field.slice(0, 64),
});

/** Elements of a plain decision table and its diagram interchange. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'definitions',
  'decision',
  'decisionTable',
  'input',
  'inputExpression',
  'text',
  'output',
  'rule',
  'inputEntry',
  'outputEntry',
  'description',
  'DMNDI',
  'DMNDiagram',
  'DMNShape',
  'Bounds',
]);

/** Attributes of those elements: no expression language, type language or aggregation. */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'name',
  'namespace',
  'label',
  'hitPolicy',
  'typeRef',
  'exporter',
  'exporterVersion',
  'dmnElementRef',
  'x',
  'y',
  'width',
  'height',
]);

/** Where each table element may stand. */
const PARENTS: Readonly<Record<string, string>> = {
  decision: 'definitions',
  decisionTable: 'decision',
  input: 'decisionTable',
  inputExpression: 'input',
  output: 'decisionTable',
  rule: 'decisionTable',
  inputEntry: 'rule',
  outputEntry: 'rule',
};
/** The elements whose `text` child the engine evaluates. */
const CELLS: ReadonlySet<string> = new Set(['inputExpression', 'inputEntry', 'outputEntry']);

const HIT_POLICIES: ReadonlySet<string> = new Set(['UNIQUE', 'FIRST', 'ANY']);
const TYPE_REFS: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'integer',
  'long',
  'double',
]);

const ELEMENT_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const HAS_EXPRESSION = /[$#]\{/;
/** A variable the table reads or sets. */
const VARIABLE = /^[a-z][A-Za-z0-9]{0,63}$/;
/** A literal: a number, a flag, or a quoted code of the characters a core variable may hold. */
const LITERAL = String.raw`(?:-?\d{1,15}(?:\.\d{1,15})?|true|false|"[A-Za-z0-9 _.:-]{0,64}"|'[A-Za-z0-9 _.:-]{0,64}')`;
const OUTPUT_ENTRY = new RegExp(`^${LITERAL}$`);
const INPUT_ENTRY = new RegExp(`^(?:-|(?:(?:==|!=|<=|>=|<|>)\\s*)?${LITERAL})?$`);

/** Names an input must not read: the engine's own objects and the host's environment. */
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
  'true',
  'false',
  'null',
  'empty',
  'not',
  'and',
  'or',
  'eq',
  'ne',
  'lt',
  'gt',
  'le',
  'ge',
  'div',
  'mod',
  'instanceof',
]);

/** A decision table as the core stores and deploys it, or why it is refused. */
export function checkDmn(xml: string, decisionKey: string): Result<CheckedDecision, DmnRefusal> {
  if (new TextEncoder().encode(xml).length > MAX_DMN_BYTES) {
    return err({ code: 'process.dmn.too-large' });
  }
  if (!DECISION_KEY.test(decisionKey) || decisionKey.startsWith(RESERVED_DECISION_PREFIX)) {
    return err({ code: 'process.dmn.decision-key-mismatch' });
  }

  const decisions: (string | null)[] = [];
  let tables = 0;
  const inputs: string[] = [];
  const outputs: string[] = [];
  let inputColumns = 0;
  let rules = 0;
  let ruleEntries = { inputs: 0, outputs: 0 };
  /** The cell whose `text` is being read. */
  let cell: string | null = null;
  let cellText: string | null = null;

  const start = (tag: XmlStartTag): DmnRefusal | null => {
    const { element, parent } = tag;
    if (!ALLOWED_ELEMENTS.has(element)) return refusal(element);
    const home = PARENTS[element];
    if (home !== undefined && parent !== home) return refusal(element);
    if (element === 'text' && (parent === undefined || !CELLS.has(parent))) return refusal('text');
    if (parent === 'text') return refusal(element);
    const attributes = new Map<string, string>();
    for (const [attributeName, value] of tag.attributes) {
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) continue;
      const local = localName(attributeName);
      if (!ALLOWED_ATTRIBUTES.has(local)) return refusal(local);
      if (attributes.has(local)) return MALFORMED;
      attributes.set(local, value);
      if (HAS_EXPRESSION.test(value)) return refusal('expression');
      if (local === 'id' && !ELEMENT_ID.test(value)) return refusal('id');
      if (local === 'hitPolicy' && !HIT_POLICIES.has(value)) return refusal('hitPolicy');
      if (local === 'typeRef' && !TYPE_REFS.has(value)) return refusal('typeRef');
    }
    switch (element) {
      case 'decision':
        decisions.push(attributes.get('id') ?? null);
        break;
      case 'decisionTable':
        tables += 1;
        break;
      case 'output': {
        // The engine sets the output as a process variable: never one the core reads.
        const name = attributes.get('name');
        if (name === undefined || !VARIABLE.test(name)) return refusal('output');
        if (name.startsWith(RESERVED_VARIABLE_PREFIX) || RESERVED_IDENTIFIERS.has(name)) {
          return refusal('output');
        }
        if (outputs.includes(name) || rules > 0) return MALFORMED;
        outputs.push(name);
        break;
      }
      case 'input':
        if (rules > 0) return MALFORMED;
        inputColumns += 1;
        break;
      case 'rule':
        rules += 1;
        ruleEntries = { inputs: 0, outputs: 0 };
        break;
      case 'inputEntry':
        ruleEntries.inputs += 1;
        break;
      case 'outputEntry':
        ruleEntries.outputs += 1;
        break;
    }
    if (CELLS.has(element)) {
      cell = element;
      cellText = null;
    }
    return null;
  };

  const end = (element: string, text: string): DmnRefusal | null => {
    if (element === 'text') {
      if (cell === null || cellText !== null) return MALFORMED;
      cellText = text.trim();
      return null;
    }
    // Every other element's own text is layout: never an expression.
    if (HAS_EXPRESSION.test(text)) return refusal('expression');
    // One input expression per input column.
    if (element === 'input' && inputs.length !== inputColumns) return MALFORMED;
    if (element === 'rule') {
      if (ruleEntries.inputs !== inputs.length || ruleEntries.outputs !== outputs.length) {
        return MALFORMED;
      }
    }
    if (element === 'decisionTable' && (outputs.length === 0 || rules === 0)) return MALFORMED;
    if (!CELLS.has(element)) return null;
    const value = cellText ?? '';
    cell = null;
    cellText = null;
    if (element === 'inputExpression') {
      if (!VARIABLE.test(value) || RESERVED_IDENTIFIERS.has(value)) return refusal('expression');
      inputs.push(value);
      return null;
    }
    const pattern = element === 'inputEntry' ? INPUT_ENTRY : OUTPUT_ENTRY;
    return pattern.test(value) ? null : refusal('expression');
  };

  const scanned = scanXml(xml, { start, end });
  if (scanned !== null) {
    if (!isScanFailure(scanned)) return err(scanned);
    return scanned.kind === 'malformed' ? err(MALFORMED) : err(refusal('declaration'));
  }
  if (decisions.length !== 1 || decisions[0] !== decisionKey || tables !== 1) {
    return err({ code: 'process.dmn.decision-key-mismatch' });
  }
  if (
    rules > MAX_DMN_RULES ||
    inputs.length > MAX_DMN_COLUMNS ||
    outputs.length > MAX_DMN_COLUMNS ||
    rules * (inputs.length + outputs.length) > MAX_DMN_CELLS
  ) {
    return err(refusal('rule'));
  }
  return ok({ inputs, outputs });
}
