import {
  addNode,
  checkDesign,
  compileDesign,
  emptyDesign,
  fieldsOf,
  MAX_COLUMNS,
  MAX_DEPTH,
  moveNode,
  newField,
  parseDesign,
  removeNode,
  updateField,
  updateLabels,
  type DesignField,
  type DesignSection,
  type FormDesign,
} from './form-design';

// The two tenant fixtures' default locales (config/tenants: demo-fa and demo-en).
const TENANTS = [
  { locale: 'fa-IR', other: 'en-CA', label: 'نام' },
  { locale: 'en-CA', other: 'fa-IR', label: 'Name' },
];

const counter = () => {
  let n = 0;
  return () => `k${(n += 1)}`;
};

function field(mint: () => string, name: string, patch: Partial<DesignField> = {}): DesignField {
  return { ...newField(mint, 'text', new Set()), name, ...patch };
}

describe.each(TENANTS)('form design ($locale)', ({ locale, other, label }) => {
  function sample(): { design: FormDesign; mint: () => string } {
    const mint = counter();
    let design = emptyDesign(mint);
    const step = design.steps[0]!.key;
    design = addNode(
      design,
      step,
      field(mint, 'fullName', { labels: { [locale]: label, [other]: 'x' }, required: true }),
    )!;
    const row = {
      kind: 'row' as const,
      key: mint(),
      fields: [
        field(mint, 'birth', { type: 'date', labels: { [locale]: 'b' }, span: 4 }),
        field(mint, 'city', {
          type: 'select',
          labels: { [locale]: 'c' },
          choices: [
            { value: 'a', labels: { [locale]: 'A', [other]: 'A2' } },
            { value: 'b', labels: { [locale]: 'B' } },
          ],
        }),
      ],
    };
    design = addNode(design, step, row)!;
    const section: DesignSection = {
      kind: 'section',
      key: mint(),
      labels: { [locale]: 's' },
      children: [
        field(mint, 'note', { type: 'textarea', labels: { [locale]: 'n' }, maxLength: 500 }),
        field(mint, 'agree', { type: 'checkbox', labels: { [locale]: 'g' }, required: true }),
      ],
    };
    design = addNode(design, step, section)!;
    return { design, mint };
  }

  it('compiles plain draft-07 data with translations only in the UI Schema', () => {
    const { design } = sample();
    expect(checkDesign(design, locale)).toEqual([]);
    const { jsonSchema, uiSchema, fields } = compileDesign(design, locale);
    expect(jsonSchema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['fullName'], // a checkbox is never required (unchecked is an answer)
    });
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(properties)).toEqual(['fullName', 'birth', 'city', 'note', 'agree']);
    expect(properties.fullName).toEqual({ type: 'string', title: label });
    expect(properties.birth).toEqual({ type: 'string', format: 'date', title: 'b' });
    expect(properties.city).toEqual({ type: 'string', title: 'c', enum: ['a', 'b'] });
    expect(properties.note).toEqual({ type: 'string', title: 'n', maxLength: 500 });
    expect(JSON.stringify(jsonSchema)).not.toContain(other);
    expect(uiSchema.type).toBe('VerticalLayout');
    const [first, row, group] = uiSchema.elements as Record<string, unknown>[];
    expect(first).toMatchObject({
      scope: '#/properties/fullName',
      options: { labels: { [locale]: label, [other]: 'x' } },
    });
    expect(row).toMatchObject({
      type: 'HorizontalLayout',
      elements: [{ options: { span: 4 } }, {}],
    });
    expect(group).toMatchObject({ type: 'Group', label: 's' });
    expect(fields.fullName).toEqual({ sensitive: true, portal: 'hidden' });
  });

  it('round-trips through a saved revision, keeping field ids', () => {
    const { design, mint } = sample();
    const compiled = compileDesign(design, locale);
    const saved = fieldsOf(design).map((f, i) => ({
      id: `id-${i}`,
      name: f.name,
      sensitive: i !== 0,
    }));
    const parsed = parseDesign(compiled.jsonSchema, compiled.uiSchema, saved, locale, mint);
    expect(parsed).not.toBeNull();
    const again = compileDesign(parsed!, locale);
    expect(again.jsonSchema).toEqual(compiled.jsonSchema);
    expect(again.uiSchema).toEqual(compiled.uiSchema);
    expect(again.fields.fullName).toEqual({ id: 'id-0', sensitive: false, portal: 'hidden' });
  });

  it('compiles two or more steps as a stepper and parses it back', () => {
    const { design, mint } = sample();
    const two: FormDesign = {
      steps: [
        ...design.steps,
        {
          key: mint(),
          labels: { [locale]: 'دوم' },
          children: [field(mint, 'extra', { labels: { [locale]: 'e' } })],
        },
      ],
    };
    const { jsonSchema, uiSchema } = compileDesign(two, locale);
    expect(uiSchema).toMatchObject({
      type: 'Categorization',
      elements: [{ type: 'Category' }, { type: 'Category', label: 'دوم' }],
    });
    expect(parseDesign(jsonSchema, uiSchema, null, locale, mint)?.steps).toHaveLength(2);
  });

  it('refuses a revision with anything the designer cannot edit', () => {
    const mint = counter();
    const base = { type: 'object', properties: { a: { type: 'string' } } };
    const control = { type: 'Control', scope: '#/properties/a' };
    expect(
      parseDesign(base, { type: 'VerticalLayout', elements: [control] }, null, locale, mint),
    ).not.toBeNull();
    expect(
      parseDesign(
        base,
        { type: 'VerticalLayout', elements: [{ type: 'ListWithDetail', scope: '#/properties/a' }] },
        null,
        locale,
        mint,
      ),
    ).toBeNull();
    expect(
      parseDesign(
        { type: 'object', properties: { a: { type: 'array' } } },
        { type: 'VerticalLayout', elements: [control] },
        null,
        locale,
        mint,
      ),
    ).toBeNull();
    // A property without a control would be dropped: refused.
    expect(
      parseDesign(
        { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
        { type: 'VerticalLayout', elements: [control] },
        null,
        locale,
        mint,
      ),
    ).toBeNull();
  });

  it('reports what blocks saving', () => {
    const mint = counter();
    const step = emptyDesign(mint);
    expect(checkDesign(step, locale)).toEqual([{ key: null, problem: 'empty' }]);
    let design = addNode(step, step.steps[0]!.key, field(mint, '1bad'))!;
    design = addNode(
      design,
      design.steps[0]!.key,
      field(mint, 'ok', { labels: { [locale]: 'x' }, minLength: 5, maxLength: 2, pattern: '(' }),
    )!;
    design = addNode(
      design,
      design.steps[0]!.key,
      field(mint, 'ok', { labels: { [locale]: 'y' }, type: 'select' }),
    )!;
    expect(checkDesign(design, locale).map((issue) => issue.problem)).toEqual([
      'name-invalid',
      'label-missing',
      'range-invalid',
      'pattern-invalid',
      'name-taken',
      'choices-missing',
    ]);
  });

  it('caps columns per row and section depth', () => {
    const mint = counter();
    let design = emptyDesign(mint);
    const step = design.steps[0]!.key;
    const rowKey = mint();
    design = addNode(design, step, { kind: 'row', key: rowKey, fields: [] })!;
    for (let i = 0; i < MAX_COLUMNS; i += 1)
      design = addNode(design, rowKey, field(mint, `c${i}`))!;
    expect(addNode(design, rowKey, field(mint, 'over'))).toBeNull();
    let parent = step;
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      const key = mint();
      design = addNode(design, parent, { kind: 'section', key, labels: {}, children: [] })!;
      parent = key;
    }
    expect(
      addNode(design, parent, { kind: 'section', key: mint(), labels: {}, children: [] }),
    ).toBeNull();
  });

  it('moves, edits and removes nodes without touching the rest', () => {
    const { design } = sample();
    const [a, b] = design.steps[0]!.children;
    const moved = moveNode(design, b!.key, -1);
    expect(moved.steps[0]!.children.map((n) => n.key)).toEqual([
      b!.key,
      a!.key,
      design.steps[0]!.children[2]!.key,
    ]);
    expect(moveNode(design, a!.key, -1)).toEqual(design);
    const renamed = updateField(design, a!.key, { name: 'person' });
    expect(fieldsOf(renamed)[0]!.name).toBe('person');
    const labelled = updateLabels(design, design.steps[0]!.key, { [locale]: 'گام' });
    expect(labelled.steps[0]!.labels).toEqual({ [locale]: 'گام' });
    // Removing the row's last field removes the row.
    const row = b as unknown as { fields: DesignField[]; key: string };
    let less = removeNode(design, row.fields[0]!.key);
    less = removeNode(less, row.fields[1]!.key);
    expect(less.steps[0]!.children.map((n) => n.kind)).toEqual(['field', 'section']);
  });
});
