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
});
