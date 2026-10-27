import { AjvFormSchemaChecker } from './ajv-form-schema-checker';
import { checkRevisionDocuments } from '../application/revision-documents';

// The revision documents through the real Ajv checker: the checks the meta-schema and the
// compiler add to the shape rules, and the content hash.

const checker = new AjvFormSchemaChecker();

const jsonSchema = {
  type: 'object',
  required: ['fullName', 'visitDate'],
  properties: {
    fullName: { type: 'string', minLength: 2, maxLength: 200 },
    email: { type: 'string', format: 'email' },
    visitDate: { type: 'string', format: 'date' },
    reason: { type: 'string', enum: ['complaint', 'request', 'other'] },
  },
};
const uiSchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/fullName' },
    { type: 'Control', scope: '#/properties/visitDate' },
  ],
};

describe('checkRevisionDocuments', () => {
  it('accepts a draft-07 schema with standard formats and hashes it canonically', () => {
    const checked = checkRevisionDocuments(checker, jsonSchema, uiSchema);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Key order does not change the hash; a changed document does.
    const reordered = checkRevisionDocuments(
      checker,
      { properties: jsonSchema.properties, required: jsonSchema.required, type: 'object' },
      { elements: uiSchema.elements, type: 'VerticalLayout' },
    );
    expect(reordered.ok && reordered.value.contentHash).toBe(checked.value.contentHash);
    const changed = checkRevisionDocuments(checker, jsonSchema, {
      ...uiSchema,
      elements: uiSchema.elements.slice(0, 1),
    });
    expect(changed.ok && changed.value.contentHash).not.toBe(checked.value.contentHash);
  });

  it('refuses what the meta-schema refuses, naming where', () => {
    const result = checkRevisionDocuments(
      checker,
      { type: 'object', properties: { age: { type: 'integer', minimum: 'ten' } } },
      { type: 'VerticalLayout' },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'forms.schema.invalid',
        field: 'jsonSchema',
        problem: 'meta-schema',
        pointer: '/properties/age/minimum',
      },
    });
  });

  it.each([
    ['an unknown keyword', { type: 'string', minLenght: 2 }],
    ['an unknown format', { type: 'string', format: 'jalali-date' }],
    ['a reference to nothing', { $ref: '#/definitions/missing' }],
  ])('refuses %s as not compilable', (_case, property) => {
    const result = checkRevisionDocuments(
      checker,
      { type: 'object', properties: { field: property } },
      { type: 'VerticalLayout' },
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'forms.schema.invalid', field: 'jsonSchema', problem: 'not-compilable' },
    });
  });

  it('checks the same schema twice without state left from the first check', () => {
    const withId = { $id: 'urn:phoenix:test', ...jsonSchema };
    expect(checkRevisionDocuments(checker, withId, uiSchema).ok).toBe(true);
    expect(checkRevisionDocuments(checker, { ...withId }, uiSchema).ok).toBe(true);
  });

  it('refuses a document that is not canonical JSON or is too large', () => {
    expect(
      checkRevisionDocuments(checker, { type: 'object', properties: { a: undefined } }, uiSchema),
    ).toMatchObject({ error: { field: 'jsonSchema', problem: 'not-an-object' } });
    const big = { type: 'object', properties: {}, description: 'x'.repeat(256 * 1024) };
    expect(checkRevisionDocuments(checker, big, uiSchema)).toMatchObject({
      error: { field: 'jsonSchema', problem: 'too-large' },
    });
    expect(checkRevisionDocuments(checker, jsonSchema, null)).toMatchObject({
      error: { field: 'uiSchema', problem: 'not-an-object' },
    });
  });

  it('compiles a definition referenced many times without inlining it (security review H1)', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`f${i}`, { type: 'string', maxLength: 10 }]),
    );
    const properties = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`p${i}`, { $ref: '#/definitions/block' }]),
    );
    const started = process.hrtime.bigint();
    const result = checkRevisionDocuments(
      checker,
      {
        type: 'object',
        properties,
        definitions: { block: { type: 'object', properties: fields } },
      },
      { type: 'VerticalLayout' },
    );
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    expect(result.ok).toBe(true);
    // With inlining this shape took about 15 s and 300 MB; without it, well under a second.
    expect(seconds).toBeLessThan(5);
  });

  it('refuses a schema with more references or members than the bound', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => [`p${i}`, { $ref: '#/definitions/s' }]),
    );
    expect(
      checkRevisionDocuments(
        checker,
        { type: 'object', properties, definitions: { s: { type: 'string' } } },
        { type: 'VerticalLayout' },
      ),
    ).toMatchObject({ error: { field: 'jsonSchema', problem: 'too-complex' } });
    const wide = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, i) => [`p${i}`, { type: 'string' }]),
    );
    expect(
      checkRevisionDocuments(
        checker,
        { type: 'object', properties: wide },
        { type: 'VerticalLayout' },
      ),
    ).toMatchObject({ error: { problem: 'too-complex' } });
  });

  it('accepts draft-07 named explicitly and refuses any other $schema with a 422, not a throw', () => {
    const named = { $schema: 'http://json-schema.org/draft-07/schema#', ...jsonSchema };
    expect(checkRevisionDocuments(checker, named, uiSchema).ok).toBe(true);
    for (const $schema of [
      'http://evil.example/x',
      'https://json-schema.org/draft/2020-12/schema',
    ]) {
      expect(checkRevisionDocuments(checker, { ...jsonSchema, $schema }, uiSchema)).toEqual({
        ok: false,
        error: {
          code: 'forms.schema.invalid',
          field: 'jsonSchema',
          problem: 'unsupported-draft',
          pointer: '/$schema',
        },
      });
    }
  });

  it('answers a schema that overflows the compiler as not compilable, and checks the next one cleanly', () => {
    const loop = { type: 'object', properties: { a: { $ref: '#/properties/a' } } };
    const result = checkRevisionDocuments(checker, loop, { type: 'VerticalLayout' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'forms.schema.invalid', field: 'jsonSchema', problem: 'not-compilable' },
    });
    expect(checkRevisionDocuments(checker, jsonSchema, uiSchema).ok).toBe(true);
  });
});
