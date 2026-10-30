import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { buildOpenApiDocument } from '../src/openapi';
import { createTestApp } from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

// The HTTP edge of the objects module (slice 2.8), without a database: every request here is
// anonymous, so each route of the studio API and of the generated record API is refused by the
// gate before any unit of work opens, and a malformed request before the gate. The database
// behaviour is in test/db/objects.db-spec.ts.

const unauthenticated = { statusCode: 401, code: 'access.unauthenticated' };

describe('the objects API (HTTP)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes every objects operation in the OpenAPI document', () => {
    type Operation = {
      summary?: string;
      requestBody?: unknown;
      responses: Record<string, { content?: unknown }>;
    };
    const objects = Object.entries(buildOpenApiDocument(app).paths)
      .filter(([path]) => path.startsWith('/objects/'))
      .flatMap(([path, item]) =>
        Object.entries(item as Record<string, Operation>).map(
          ([method, operation]) => [`${method.toUpperCase()} ${path}`, operation] as const,
        ),
      );
    expect(objects).toHaveLength(15);
    for (const [name, operation] of objects) {
      const method = name.split(' ')[0]!;
      const success = Object.keys(operation.responses).filter((status) => status.startsWith('2'));
      expect({ name, summary: typeof operation.summary }).toEqual({ name, summary: 'string' });
      expect({ name, body: operation.requestBody !== undefined }).toEqual({
        name,
        body: method === 'POST' || method === 'PATCH',
      });
      expect({ name, success: success.length }).toEqual({ name, success: 1 });
      expect({ name, described: operation.responses[success[0]!]!.content !== undefined }).toEqual({
        name,
        described: success[0] !== '204',
      });
      expect({ name, refusal: operation.responses['401']?.content !== undefined }).toEqual({
        name,
        refusal: true,
      });
    }
  });

  describe.each(TEST_TENANTS)('in tenant %s', (tenant) => {
    const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      request(app.getHttpServer())[method](path).set('x-tenant-id', tenant);
    const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
    const field = { key: 'title', label: 'عنوان', type: 'text' };

    it.each([
      ['get', '/objects/definitions', undefined],
      ['post', '/objects/definitions', { siteId: ID, key: 'contracts', name: 'قراردادها' }],
      ['get', `/objects/definitions/${ID}`, undefined],
      ['patch', `/objects/definitions/${ID}`, { version: 1, name: 'x' }],
      ['post', `/objects/definitions/${ID}/revisions`, { fields: [field] }],
      ['get', `/objects/revisions/${ID}`, undefined],
      ['post', `/objects/definitions/${ID}/publish`, { version: 1, revisionId: ID }],
      ['post', `/objects/definitions/${ID}/retire`, { version: 1 }],
      ['get', '/objects/o/contracts', undefined],
      ['get', '/objects/o/contracts/records', undefined],
      ['post', '/objects/o/contracts/records', { values: { title: 'x' } }],
      ['get', `/objects/o/contracts/records/${ID}`, undefined],
      ['patch', `/objects/o/contracts/records/${ID}`, { version: 1, values: { title: 'y' } }],
      ['delete', `/objects/o/contracts/records/${ID}?version=1`, undefined],
      ['post', '/objects/o/contracts/graphql', { query: '{ records { next } }' }],
    ] as const)('refuses an anonymous %s %s with 401', async (method, path, body) => {
      const response = await call(method, path).send(body);
      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it('answers 400 request.invalid with the field for a malformed body or query', async () => {
      const type = await call('post', `/objects/definitions/${ID}/revisions`).send({
        fields: [{ ...field, type: 'file' }],
      });
      expect(type.body).toEqual({
        statusCode: 400,
        code: 'request.invalid',
        field: 'fields.0.type',
      });
      const nested = await call('post', '/objects/o/contracts/records').send({
        values: { title: { $ne: 1 } },
      });
      expect(nested.status).toBe(400);
      const extra = await call('patch', `/objects/o/contracts/records/${ID}`).send({
        version: 1,
        values: {},
        siteId: ID,
      });
      expect(extra.body).toMatchObject({ code: 'request.invalid' });
      const limit = await call('get', '/objects/o/contracts/records?limit=101');
      expect(limit.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'limit' });
      const version = await call('delete', `/objects/o/contracts/records/${ID}`);
      expect(version.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'version' });
    });

    it('answers 400 request.invalid for a malformed GraphQL request, before the gate', async () => {
      for (const body of [
        [{ query: '{ records { next } }' }],
        { query: '' },
        { query: '{ a }', extensions: {} },
        { query: 'x'.repeat(20_001) },
      ]) {
        const response = await call('post', '/objects/o/contracts/graphql').send(body);
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ statusCode: 400, code: 'request.invalid' });
      }
      const site = await call('post', '/objects/o/contracts/graphql?site=1').send({
        query: '{ a }',
      });
      expect(site.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'site' });
    });

    it('answers 404 for a path id or key that cannot exist', async () => {
      const definition = await call('get', '/objects/definitions/contracts');
      expect(definition.body).toEqual({ statusCode: 404, code: 'objects.definition.not-found' });
      const record = await call('get', '/objects/o/contracts/records/1');
      expect(record.body).toEqual({ statusCode: 404, code: 'objects.record.not-found' });
      const key = await call('get', '/objects/o/Contracts_1/records');
      expect(key.body).toEqual({ statusCode: 404, code: 'objects.definition.not-found' });
    });
  });
});
