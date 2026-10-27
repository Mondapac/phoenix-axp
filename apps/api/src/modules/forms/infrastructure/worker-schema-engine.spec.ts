import type { ContentHash } from '@phoenix/shared-kernel';
import { checkRevisionDocuments } from '../application/revision-documents';
import { SCHEMA_WORKER_LIMITS, WorkerSchemaEngine } from './worker-schema-engine';

// The revision documents through the real engine (Ajv in its worker thread): the checks the
// meta-schema and the compiler add to the shape rules, and the content hash; then the
// submission validator, RE2 patterns and the worker's isolation.

const checker = new WorkerSchemaEngine();
afterAll(() => checker.onApplicationShutdown());

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
  it('accepts a draft-07 schema with standard formats and hashes it canonically', async () => {
    const checked = await checkRevisionDocuments(checker, jsonSchema, uiSchema);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Key order does not change the hash; a changed document does.
    const reordered = await checkRevisionDocuments(
      checker,
      { properties: jsonSchema.properties, required: jsonSchema.required, type: 'object' },
      { elements: uiSchema.elements, type: 'VerticalLayout' },
    );
    expect(reordered.ok && reordered.value.contentHash).toBe(checked.value.contentHash);
    const changed = await checkRevisionDocuments(checker, jsonSchema, {
      ...uiSchema,
      elements: uiSchema.elements.slice(0, 1),
    });
    expect(changed.ok && changed.value.contentHash).not.toBe(checked.value.contentHash);
  });

  it('refuses what the meta-schema refuses, naming where', async () => {
    const result = await checkRevisionDocuments(
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
  ])('refuses %s as not compilable', async (_case, property) => {
    const result = await checkRevisionDocuments(
      checker,
      { type: 'object', properties: { field: property } },
      { type: 'VerticalLayout' },
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'forms.schema.invalid', field: 'jsonSchema', problem: 'not-compilable' },
    });
  });

  it('checks the same schema twice without state left from the first check', async () => {
    const withId = { $id: 'urn:phoenix:test', ...jsonSchema };
    expect((await checkRevisionDocuments(checker, withId, uiSchema)).ok).toBe(true);
    expect((await checkRevisionDocuments(checker, { ...withId }, uiSchema)).ok).toBe(true);
  });

  it('refuses a document that is not canonical JSON or is too large', async () => {
    expect(
      await checkRevisionDocuments(
        checker,
        { type: 'object', properties: { a: undefined } },
        uiSchema,
      ),
    ).toMatchObject({ error: { field: 'jsonSchema', problem: 'not-an-object' } });
    const big = { type: 'object', properties: {}, description: 'x'.repeat(256 * 1024) };
    expect(await checkRevisionDocuments(checker, big, uiSchema)).toMatchObject({
      error: { field: 'jsonSchema', problem: 'too-large' },
    });
    expect(await checkRevisionDocuments(checker, jsonSchema, null)).toMatchObject({
      error: { field: 'uiSchema', problem: 'not-an-object' },
    });
  });

  it('compiles a definition referenced many times without inlining it (security review H1)', async () => {
    const fields = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`f${i}`, { type: 'string', maxLength: 10 }]),
    );
    const properties = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`p${i}`, { $ref: '#/definitions/block' }]),
    );
    const started = process.hrtime.bigint();
    const result = await checkRevisionDocuments(
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

  it('refuses a schema with more references or members than the bound', async () => {
    const properties = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => [`p${i}`, { $ref: '#/definitions/s' }]),
    );
    expect(
      await checkRevisionDocuments(
        checker,
        { type: 'object', properties, definitions: { s: { type: 'string' } } },
        { type: 'VerticalLayout' },
      ),
    ).toMatchObject({ error: { field: 'jsonSchema', problem: 'too-complex' } });
    const wide = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, i) => [`p${i}`, { type: 'string' }]),
    );
    expect(
      await checkRevisionDocuments(
        checker,
        { type: 'object', properties: wide },
        { type: 'VerticalLayout' },
      ),
    ).toMatchObject({ error: { problem: 'too-complex' } });
  });

  it('accepts draft-07 named explicitly and refuses any other $schema with a 422, not a throw', async () => {
    const named = { $schema: 'http://json-schema.org/draft-07/schema#', ...jsonSchema };
    expect((await checkRevisionDocuments(checker, named, uiSchema)).ok).toBe(true);
    for (const $schema of [
      'http://evil.example/x',
      'https://json-schema.org/draft/2020-12/schema',
    ]) {
      expect(await checkRevisionDocuments(checker, { ...jsonSchema, $schema }, uiSchema)).toEqual({
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

  it('answers a schema that overflows the compiler as not compilable, and checks the next one cleanly', async () => {
    const loop = { type: 'object', properties: { a: { $ref: '#/properties/a' } } };
    const result = await checkRevisionDocuments(checker, loop, { type: 'VerticalLayout' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'forms.schema.invalid', field: 'jsonSchema', problem: 'not-compilable' },
    });
    expect((await checkRevisionDocuments(checker, jsonSchema, uiSchema)).ok).toBe(true);
  });
});

describe('the submission validator', () => {
  const revision = (n: number, schema: object) => ({
    contentHash: `sha256:${String(n).padStart(64, '0')}` as ContentHash,
    jsonSchema: schema as never,
  });
  const schema = {
    type: 'object',
    required: ['fullName'],
    properties: {
      fullName: { type: 'string', minLength: 2, pattern: '^\\p{L}[\\p{L} \u200c]*$' },
      code: { type: 'string', pattern: '^(a+)+$' },
      email: { type: 'string', format: 'email' },
    },
  };

  it('accepts valid answers, with Unicode letter classes for Persian names', async () => {
    await expect(
      checker.validate(revision(1, schema), { fullName: 'زهرا محمدی', email: 'z@example.org' }),
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  it('refuses invalid answers naming places and keywords, never values', async () => {
    const result = await checker.validate(revision(1, schema), { email: 'not-an-email' });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'forms.submission.invalid',
        problems: expect.arrayContaining([
          { pointer: '/fullName', keyword: 'required' },
          { pointer: '/email', keyword: 'format' },
        ]) as unknown,
      },
    });
    expect(JSON.stringify(result)).not.toContain('not-an-email');
  });

  it('runs a backtracking-prone pattern in linear time (RE2, no ReDoS)', async () => {
    const started = process.hrtime.bigint();
    const result = await checker.validate(revision(1, schema), {
      fullName: 'زهرا',
      code: `${'a'.repeat(50_000)}b`,
    });
    expect(result).toMatchObject({ ok: false, error: { problems: [{ keyword: 'pattern' }] } });
    expect(Number(process.hrtime.bigint() - started) / 1e9).toBeLessThan(2);
  });

  it('refuses at save a pattern RE2 cannot run (lookaround, backreference)', async () => {
    for (const pattern of ['(?=a)a', '(a)\\1']) {
      expect(
        await checker.check({ type: 'object', properties: { a: { type: 'string', pattern } } }),
      ).toEqual({
        ok: false,
        error: { code: 'forms.schema.invalid', field: 'jsonSchema', problem: 'not-compilable' },
      });
    }
  });

  it('ends a worker that runs past its time limit, refuses only that request, and serves the ones queued behind it', async () => {
    // `uniqueItems` over objects compares every pair: 30 000 items take far longer than the
    // limit. The API process only waits for the timeout; the worker is replaced.
    const slow = revision(2, {
      type: 'object',
      properties: { list: { type: 'array', uniqueItems: true } },
    });
    const list = Array.from({ length: 30_000 }, (_, i) => ({ n: i, pad: 'x' }));
    const started = process.hrtime.bigint();
    // A request queued behind the slow one is not refused with it (security review M1).
    const [slowResult, queued] = await Promise.all([
      checker.validate(slow, { list }),
      checker.validate(revision(1, schema), { fullName: 'Ali' }),
    ]);
    expect(slowResult).toEqual({
      ok: false,
      error: { code: 'forms.submission.invalid', problems: [{ pointer: '', keyword: 'limit' }] },
    });
    expect(queued).toEqual({ ok: true, value: undefined });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    expect(seconds).toBeLessThan(SCHEMA_WORKER_LIMITS.validateTimeoutMs / 1000 + 3);
  }, 30_000);
});
