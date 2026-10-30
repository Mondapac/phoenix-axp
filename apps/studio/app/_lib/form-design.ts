// The form designer's model (phase 2 slice 2.9, designer step 1): fields, rows of columns,
// nested sections and steps, compiled to the two documents a form revision holds (ADR-0007):
// a plain draft-07 JSON Schema (the API's Ajv is strict, so no custom keywords) and a JSON
// Forms UI Schema. Translations, column spans and choice labels live in the UI Schema's
// `options`; packages/ui's SchemaForm reads them back. A revision the designer did not write is
// parsed when its shape allows, otherwise the designer says so and does not touch it.

export const FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'number',
  'integer',
  'date',
  'select',
  'checkbox',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const PORTAL_MODES = ['hidden', 'read', 'edit'] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/** Team defaults (phase 2 review notes, not owner-confirmed): 4 columns, 4 section levels. */
export const MAX_COLUMNS = 4;
export const MAX_DEPTH = 4;
/** The API's limit on fields per revision (modules/forms/domain/form-fields.ts). */
export const MAX_FIELDS = 256;
export const MAX_STEPS = 12;
export const MAX_CHOICES = 100;
/** A property name: a letter, then letters, digits or underscores (stable in answers and APIs). */
export const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type Texts = Readonly<Record<string, string>>;

export interface Choice {
  readonly value: string;
  readonly labels: Texts;
}

export interface DesignField {
  readonly kind: 'field';
  /** The designer's own key for this node; not stored. */
  readonly key: string;
  /** The JSON Schema property name. */
  readonly name: string;
  readonly type: FieldType;
  readonly labels: Texts;
  readonly descriptions: Texts;
  readonly required: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly choices: readonly Choice[];
  /** Columns of 12 inside a row; null shares the rest evenly. */
  readonly span: number | null;
  /** The API's field id (UUIDv7) once saved: keeps rules and answers across a rename. */
  readonly fieldId?: string;
  readonly sensitive: boolean;
  readonly portal: PortalMode;
}

export interface DesignRow {
  readonly kind: 'row';
  readonly key: string;
  readonly fields: readonly DesignField[];
}

export interface DesignSection {
  readonly kind: 'section';
  readonly key: string;
  readonly labels: Texts;
  readonly children: readonly DesignNode[];
}

export type DesignNode = DesignField | DesignRow | DesignSection;

export interface DesignStep {
  readonly key: string;
  readonly labels: Texts;
  readonly children: readonly DesignNode[];
}

/** One step is a plain form; two or more are a stepper. */
export interface FormDesign {
  readonly steps: readonly DesignStep[];
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

/** A key for a new node, from `mint` (the browser's random UUID in the designer). */
export type Mint = () => string;

export function emptyDesign(mint: Mint): FormDesign {
  return { steps: [{ key: mint(), labels: {}, children: [] }] };
}

export function newField(mint: Mint, type: FieldType, taken: ReadonlySet<string>): DesignField {
  let index = taken.size + 1;
  while (taken.has(`field${index}`)) index += 1;
  return {
    kind: 'field',
    key: mint(),
    name: `field${index}`,
    type,
    labels: {},
    descriptions: {},
    required: false,
    choices: [],
    span: null,
    // A new field is sensitive until the designer says otherwise (ADR-0024 decision 4).
    sensitive: true,
    portal: 'hidden',
  };
}

// Walking -----------------------------------------------------------------------------------

/** Every field of the design in form order. */
export function fieldsOf(design: FormDesign): DesignField[] {
  const out: DesignField[] = [];
  const walk = (nodes: readonly DesignNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'field') out.push(node);
      else if (node.kind === 'row') out.push(...node.fields);
      else walk(node.children);
    }
  };
  for (const step of design.steps) walk(step.children);
  return out;
}

/** The node with `key`, the step it is in, and its depth in sections. */
export function findNode(
  design: FormDesign,
  key: string,
): { node: DesignNode | DesignStep; depth: number } | null {
  for (const step of design.steps) {
    if (step.key === key) return { node: step, depth: 0 };
    const pending: [DesignNode, number][] = step.children.map((node) => [node, 1]);
    while (pending.length > 0) {
      const [node, depth] = pending.shift() as [DesignNode, number];
      if (node.key === key) return { node, depth };
      if (node.kind === 'row')
        pending.push(...node.fields.map((f): [DesignNode, number] => [f, depth]));
      if (node.kind === 'section') {
        pending.push(...node.children.map((c): [DesignNode, number] => [c, depth + 1]));
      }
    }
  }
  return null;
}

/** How deep sections nest under `node` (a section counts 1). */
function sectionDepth(node: DesignNode): number {
  if (node.kind !== 'section') return 0;
  return 1 + Math.max(0, ...node.children.map(sectionDepth));
}

// Changes (pure; the designer keeps the result as its state) --------------------------------

type ChildrenMap = (children: readonly DesignNode[]) => readonly DesignNode[];

/** `design` with the child list of container `key` (a step or a section) replaced. */
function mapContainer(design: FormDesign, key: string, change: ChildrenMap): FormDesign {
  const inNodes = (nodes: readonly DesignNode[]): readonly DesignNode[] =>
    nodes.map((node) => {
      if (node.kind !== 'section') return node;
      if (node.key === key) return { ...node, children: change(node.children) };
      return { ...node, children: inNodes(node.children) };
    });
  return {
    steps: design.steps.map((step) =>
      step.key === key
        ? { ...step, children: change(step.children) }
        : { ...step, children: inNodes(step.children) },
    ),
  };
}

/** Adds `node` at the end of container `key` (a step, a section, or a row for a field). */
export function addNode(design: FormDesign, key: string, node: DesignNode): FormDesign | null {
  const found = findNode(design, key);
  if (found === null) return null;
  const target = found.node;
  if ('kind' in target && target.kind === 'row') {
    if (node.kind !== 'field' || target.fields.length >= MAX_COLUMNS) return null;
    return mapNodes(design, (each) =>
      each.key === key && each.kind === 'row' ? { ...each, fields: [...each.fields, node] } : each,
    );
  }
  if ('kind' in target && target.kind === 'field') return null;
  if (found.depth + sectionDepth(node) > MAX_DEPTH) return null;
  return mapContainer(design, key, (children) => [...children, node]);
}

/** `design` with every node passed through `change` (rows' fields included). */
function mapNodes(design: FormDesign, change: (node: DesignNode) => DesignNode): FormDesign {
  const inNodes = (nodes: readonly DesignNode[]): DesignNode[] =>
    nodes.map((node) => {
      const changed = change(node);
      if (changed.kind === 'section') return { ...changed, children: inNodes(changed.children) };
      if (changed.kind === 'row') {
        return { ...changed, fields: changed.fields.map((f) => change(f) as DesignField) };
      }
      return changed;
    });
  return { steps: design.steps.map((step) => ({ ...step, children: inNodes(step.children) })) };
}

/** Replaces the field `key` with `patch` applied. */
export function updateField(
  design: FormDesign,
  key: string,
  patch: Partial<Omit<DesignField, 'kind' | 'key'>>,
): FormDesign {
  return mapNodes(design, (node) =>
    node.kind === 'field' && node.key === key ? { ...node, ...patch } : node,
  );
}

/** Replaces the labels of the section or step `key`. */
export function updateLabels(design: FormDesign, key: string, labels: Texts): FormDesign {
  const changed = mapNodes(design, (node) =>
    node.kind === 'section' && node.key === key ? { ...node, labels } : node,
  );
  return {
    steps: changed.steps.map((step) => (step.key === key ? { ...step, labels } : step)),
  };
}

/** Removes the node `key` (a row or section goes with what it holds). A row left empty goes. */
export function removeNode(design: FormDesign, key: string): FormDesign {
  const inNodes = (nodes: readonly DesignNode[]): DesignNode[] =>
    nodes.flatMap((node): DesignNode[] => {
      if (node.key === key) return [];
      if (node.kind === 'section') return [{ ...node, children: inNodes(node.children) }];
      if (node.kind === 'row') {
        const fields = node.fields.filter((field) => field.key !== key);
        return fields.length === 0 ? [] : [{ ...node, fields }];
      }
      return [node];
    });
  const steps = design.steps
    .filter((step) => step.key !== key)
    .map((step) => ({ ...step, children: inNodes(step.children) }));
  return {
    steps:
      steps.length === 0 ? design.steps.slice(0, 1).map((s) => ({ ...s, children: [] })) : steps,
  };
}

/** Moves the node or step `key` one place earlier (-1) or later (+1) among its siblings. */
export function moveNode(design: FormDesign, key: string, by: -1 | 1): FormDesign {
  const swap = <T extends { readonly key: string }>(items: readonly T[]): T[] => {
    const index = items.findIndex((item) => item.key === key);
    const target = index + by;
    if (index < 0 || target < 0 || target >= items.length) return [...items];
    const copy = [...items];
    [copy[index], copy[target]] = [copy[target] as T, copy[index] as T];
    return copy;
  };
  const inNodes = (nodes: readonly DesignNode[]): DesignNode[] =>
    swap(nodes).map((node) => {
      if (node.kind === 'section') return { ...node, children: inNodes(node.children) };
      if (node.kind === 'row') return { ...node, fields: swap(node.fields) };
      return node;
    });
  return {
    steps: swap(design.steps).map((step) => ({ ...step, children: inNodes(step.children) })),
  };
}

// Checks -------------------------------------------------------------------------------------

export type DesignProblem =
  | 'empty'
  | 'too-many-fields'
  | 'name-invalid'
  | 'name-taken'
  | 'label-missing'
  | 'choices-missing'
  | 'choice-invalid'
  | 'range-invalid'
  | 'pattern-invalid';

export interface DesignIssue {
  /** The node the problem is on; null for the whole form. */
  readonly key: string | null;
  readonly problem: DesignProblem;
}

/** What blocks saving, in form order; `defaultLocale` must have every label. */
export function checkDesign(design: FormDesign, defaultLocale: string): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const fields = fieldsOf(design);
  if (fields.length === 0) issues.push({ key: null, problem: 'empty' });
  if (fields.length > MAX_FIELDS) issues.push({ key: null, problem: 'too-many-fields' });
  const seen = new Set<string>();
  for (const field of fields) {
    if (!PROPERTY_NAME.test(field.name)) issues.push({ key: field.key, problem: 'name-invalid' });
    else if (seen.has(field.name)) issues.push({ key: field.key, problem: 'name-taken' });
    seen.add(field.name);
    if ((field.labels[defaultLocale] ?? '').trim() === '') {
      issues.push({ key: field.key, problem: 'label-missing' });
    }
    if (field.type === 'select') {
      if (field.choices.length === 0) issues.push({ key: field.key, problem: 'choices-missing' });
      const values = field.choices.map((choice) => choice.value.trim());
      if (
        values.some((value) => value === '') ||
        new Set(values).size !== values.length ||
        field.choices.length > MAX_CHOICES ||
        field.choices.some((choice) => (choice.labels[defaultLocale] ?? '').trim() === '')
      ) {
        issues.push({ key: field.key, problem: 'choice-invalid' });
      }
    }
    if (
      outOfOrder(field.minLength, field.maxLength) ||
      outOfOrder(field.minimum, field.maximum) ||
      [field.minLength, field.maxLength].some(
        (n) => n !== undefined && (!Number.isInteger(n) || n < 0),
      )
    ) {
      issues.push({ key: field.key, problem: 'range-invalid' });
    }
    if (field.pattern !== undefined && !isPattern(field.pattern)) {
      issues.push({ key: field.key, problem: 'pattern-invalid' });
    }
  }
  return issues;
}

const outOfOrder = (low: number | undefined, high: number | undefined) =>
  low !== undefined && high !== undefined && low > high;

function isPattern(pattern: string): boolean {
  if (pattern === '' || pattern.length > 512) return false;
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

// Compiling ----------------------------------------------------------------------------------

export interface FieldSetting {
  readonly id?: string;
  readonly sensitive: boolean;
  readonly portal: PortalMode;
}

export interface CompiledForm {
  readonly jsonSchema: Json;
  readonly uiSchema: Json;
  /** The `fields` member of the save-revision body, by property name. */
  readonly fields: Record<string, FieldSetting>;
}

/** Keeps only the non-empty texts. */
function texts(map: Texts): Texts | undefined {
  const kept = Object.fromEntries(Object.entries(map).filter(([, text]) => text.trim() !== ''));
  return Object.keys(kept).length === 0 ? undefined : kept;
}

function fieldSchema(field: DesignField, defaultLocale: string): Json {
  const title = field.labels[defaultLocale]?.trim() || field.name;
  const description = field.descriptions[defaultLocale]?.trim();
  const base: Json = { title, ...(description ? { description } : {}) };
  const lengths = {
    ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
    ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
  };
  const range = {
    ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
    ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
  };
  switch (field.type) {
    case 'text':
    case 'textarea':
      return {
        type: 'string',
        ...base,
        ...lengths,
        ...(field.pattern === undefined ? {} : { pattern: field.pattern }),
      };
    case 'email':
      return { type: 'string', format: 'email', ...base, ...lengths };
    case 'number':
      return { type: 'number', ...base, ...range };
    case 'integer':
      return { type: 'integer', ...base, ...range };
    case 'date':
      return { type: 'string', format: 'date', ...base };
    case 'select':
      return { type: 'string', ...base, enum: field.choices.map((choice) => choice.value.trim()) };
    case 'checkbox':
      return { type: 'boolean', ...base };
  }
}

function controlOf(field: DesignField, defaultLocale: string, inRow: boolean): Json {
  const labels = texts(field.labels);
  const descriptions = texts(field.descriptions);
  const options: Json = {
    ...(labels === undefined ? {} : { labels }),
    ...(descriptions === undefined ? {} : { descriptions }),
    ...(field.type === 'textarea' ? { multi: true } : {}),
    ...(field.type === 'select'
      ? {
          choices: field.choices.map((choice) => ({
            value: choice.value.trim(),
            labels: texts(choice.labels) ?? {},
          })),
        }
      : {}),
    ...(inRow && field.span !== null ? { span: field.span } : {}),
  };
  return {
    type: 'Control',
    scope: `#/properties/${field.name}`,
    label: field.labels[defaultLocale]?.trim() || field.name,
    ...(Object.keys(options).length === 0 ? {} : { options }),
  };
}

function elementOf(node: DesignNode, defaultLocale: string): Json {
  if (node.kind === 'field') return controlOf(node, defaultLocale, false);
  if (node.kind === 'row') {
    return {
      type: 'HorizontalLayout',
      elements: node.fields.map((field) => controlOf(field, defaultLocale, true)),
    };
  }
  const labels = texts(node.labels);
  return {
    type: 'Group',
    label: node.labels[defaultLocale]?.trim() ?? '',
    ...(labels === undefined ? {} : { options: { labels } }),
    elements: node.children.map((child) => elementOf(child, defaultLocale)),
  };
}

/** The revision documents and field settings of `design` (check it first). */
export function compileDesign(design: FormDesign, defaultLocale: string): CompiledForm {
  const fields = fieldsOf(design);
  const jsonSchema: Json = {
    $schema: DRAFT_07,
    type: 'object',
    properties: Object.fromEntries(
      fields.map((field) => [field.name, fieldSchema(field, defaultLocale)]),
    ),
  };
  const required = fields.filter((field) => field.required && field.type !== 'checkbox');
  if (required.length > 0) jsonSchema.required = required.map((field) => field.name);
  const elementsOfStep = (step: DesignStep) =>
    step.children.map((node) => elementOf(node, defaultLocale));
  const [only] = design.steps;
  const uiSchema: Json =
    design.steps.length === 1 && only !== undefined
      ? { type: 'VerticalLayout', elements: elementsOfStep(only) }
      : {
          type: 'Categorization',
          options: { variant: 'stepper' },
          elements: design.steps.map((step) => {
            const labels = texts(step.labels);
            return {
              type: 'Category',
              label: step.labels[defaultLocale]?.trim() ?? '',
              ...(labels === undefined ? {} : { options: { labels } }),
              elements: elementsOfStep(step),
            };
          }),
        };
  return {
    jsonSchema,
    uiSchema,
    fields: Object.fromEntries(
      fields.map((field) => [
        field.name,
        {
          ...(field.fieldId === undefined ? {} : { id: field.fieldId }),
          sensitive: field.sensitive,
          portal: field.portal,
        },
      ]),
    ),
  };
}

// Parsing ------------------------------------------------------------------------------------

/** A field of a saved revision, as the API returns it. */
export interface SavedField {
  readonly id: string;
  readonly name: string;
  readonly sensitive: boolean;
  readonly portal?: 'read' | 'edit';
}

const textsOf = (value: unknown): Texts =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Labels from `options.labels`, else the plain label under the default locale. */
function labelsOf(element: Json, defaultLocale: string): Texts {
  const options = isRecord(element.options) ? element.options : {};
  const labels = textsOf(options.labels);
  if (Object.keys(labels).length > 0) return labels;
  return typeof element.label === 'string' && element.label !== ''
    ? { [defaultLocale]: element.label }
    : {};
}

function typeOf(schema: Json, options: Json): FieldType | null {
  if (schema.type === 'string') {
    if (Array.isArray(schema.enum))
      return schema.enum.every((v) => typeof v === 'string') ? 'select' : null;
    if (schema.format === 'date') return 'date';
    if (schema.format === 'email') return 'email';
    if (schema.format !== undefined) return null;
    return options.multi === true ? 'textarea' : 'text';
  }
  if (schema.type === 'number') return 'number';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'boolean') return 'checkbox';
  return null;
}

/**
 * The design of a saved revision, or null when its documents use something the designer does
 * not edit (nested data, arrays, rules, other element types).
 */
export function parseDesign(
  jsonSchema: unknown,
  uiSchema: unknown,
  saved: readonly SavedField[] | null,
  defaultLocale: string,
  mint: Mint,
): FormDesign | null {
  if (!isRecord(jsonSchema) || !isRecord(jsonSchema.properties) || !isRecord(uiSchema)) return null;
  const properties = jsonSchema.properties;
  const required = new Set(Array.isArray(jsonSchema.required) ? jsonSchema.required : []);
  const byName = new Map((saved ?? []).map((field) => [field.name, field]));
  const used = new Set<string>();

  const field = (element: Json, inRow: boolean): DesignField | null => {
    if (element.type !== 'Control' || typeof element.scope !== 'string') return null;
    const match = /^#\/properties\/([^/]+)$/.exec(element.scope);
    const name = match?.[1];
    if (name === undefined || used.has(name)) return null;
    const schema = properties[name];
    if (!isRecord(schema)) return null;
    const options = isRecord(element.options) ? element.options : {};
    const type = typeOf(schema, options);
    if (type === null) return null;
    used.add(name);
    const savedField = byName.get(name);
    const labels = labelsOf(element, defaultLocale);
    const descriptions = textsOf(options.descriptions);
    const choiceLabels = new Map(
      (Array.isArray(options.choices) ? options.choices : [])
        .filter(isRecord)
        .map((choice) => [choice.value, textsOf(choice.labels)]),
    );
    const span = numberOf(options.span);
    return {
      kind: 'field',
      key: mint(),
      name,
      type,
      labels:
        Object.keys(labels).length > 0
          ? labels
          : typeof schema.title === 'string'
            ? { [defaultLocale]: schema.title }
            : {},
      descriptions:
        Object.keys(descriptions).length > 0 || typeof schema.description !== 'string'
          ? descriptions
          : { [defaultLocale]: schema.description },
      required: required.has(name),
      ...(numberOf(schema.minLength) === undefined
        ? {}
        : { minLength: numberOf(schema.minLength) }),
      ...(numberOf(schema.maxLength) === undefined
        ? {}
        : { maxLength: numberOf(schema.maxLength) }),
      ...(typeof schema.pattern === 'string' ? { pattern: schema.pattern } : {}),
      ...(numberOf(schema.minimum) === undefined ? {} : { minimum: numberOf(schema.minimum) }),
      ...(numberOf(schema.maximum) === undefined ? {} : { maximum: numberOf(schema.maximum) }),
      choices:
        type === 'select'
          ? (schema.enum as string[]).map((value) => ({
              value,
              labels: choiceLabels.get(value) ?? { [defaultLocale]: value },
            }))
          : [],
      span:
        inRow && span !== undefined && Number.isInteger(span) && span >= 1 && span <= 12
          ? span
          : null,
      ...(savedField === undefined ? {} : { fieldId: savedField.id }),
      sensitive: savedField?.sensitive ?? true,
      portal: savedField?.portal ?? 'hidden',
    };
  };

  const nodes = (elements: unknown, depth: number): DesignNode[] | null => {
    if (!Array.isArray(elements)) return null;
    const out: DesignNode[] = [];
    for (const element of elements) {
      if (!isRecord(element)) return null;
      if (element.type === 'Control') {
        const parsed = field(element, false);
        if (parsed === null) return null;
        out.push(parsed);
      } else if (element.type === 'HorizontalLayout') {
        if (!Array.isArray(element.elements) || element.elements.length > MAX_COLUMNS) return null;
        const fields: DesignField[] = [];
        for (const child of element.elements) {
          const parsed = isRecord(child) ? field(child, true) : null;
          if (parsed === null) return null;
          fields.push(parsed);
        }
        if (fields.length > 0) out.push({ kind: 'row', key: mint(), fields });
      } else if (element.type === 'Group' || element.type === 'VerticalLayout') {
        if (element.type === 'Group' && depth >= MAX_DEPTH) return null;
        const children = nodes(element.elements, element.type === 'Group' ? depth + 1 : depth);
        if (children === null) return null;
        if (element.type === 'Group') {
          out.push({
            kind: 'section',
            key: mint(),
            labels: labelsOf(element, defaultLocale),
            children,
          });
        } else out.push(...children);
      } else return null;
    }
    return out;
  };

  let steps: DesignStep[];
  if (uiSchema.type === 'Categorization') {
    if (!Array.isArray(uiSchema.elements) || uiSchema.elements.length === 0) return null;
    steps = [];
    for (const category of uiSchema.elements) {
      if (!isRecord(category) || category.type !== 'Category') return null;
      const children = nodes(category.elements, 0);
      if (children === null) return null;
      steps.push({ key: mint(), labels: labelsOf(category, defaultLocale), children });
    }
  } else if (uiSchema.type === 'VerticalLayout') {
    const children = nodes(uiSchema.elements, 0);
    if (children === null) return null;
    steps = [{ key: mint(), labels: {}, children }];
  } else return null;

  // Every property must have its control; the designer never drops a field silently.
  if (Object.keys(properties).some((name) => !used.has(name))) return null;
  return { steps };
}
