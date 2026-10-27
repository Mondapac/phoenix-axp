import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

// The HTTP edge of the forms module (slices 2.4 and 2.5), without a database: every request
// here is anonymous, so each studio route is refused by the gate before any unit of work opens,
// and a malformed request before the gate. The database behaviour is in test/db/forms.db-spec.ts
// and test/db/forms-submissions.db-spec.ts.

const unauthenticated = { statusCode: 401, code: 'access.unauthenticated' };

describe('the forms studio API (HTTP)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each(TEST_TENANTS)('in tenant %s', (tenant) => {
    const call = (method: 'get' | 'post' | 'patch' | 'put', path: string) =>
      request(app.getHttpServer())[method](path).set('x-tenant-id', tenant);
    const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
    const policy = { audience: 'anyone', roleIds: [], allowOnBehalf: false };

    it.each([
      ['get', '/forms/forms', undefined],
      ['get', `/forms/forms/${ID}`, undefined],
      ['post', '/forms/forms', { siteId: ID, key: 'visit', name: 'ملاقات', policy }],
      ['patch', `/forms/forms/${ID}`, { version: 1, name: 'x', policy }],
      ['put', `/forms/forms/${ID}/settings`, { version: 1, policy }],
      [
        'post',
        `/forms/forms/${ID}/revisions`,
        { jsonSchema: { type: 'object', properties: {} }, uiSchema: { type: 'VerticalLayout' } },
      ],
      ['get', `/forms/revisions/${ID}`, undefined],
      ['post', `/forms/forms/${ID}/publish`, { version: 1, revisionId: ID }],
      ['post', `/forms/forms/${ID}/retire`, { version: 1 }],
      ['get', `/forms/forms/${ID}/submissions`, undefined],
      ['get', `/forms/submissions/${ID}`, undefined],
      ['post', `/forms/submissions/${ID}/erase`, { version: 1 }],
    ] as const)('refuses an anonymous %s %s with 401', async (method, path, body) => {
      const response = await call(method, path).send(body);
      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it('answers 400 request.invalid with the field for a malformed body or query', async () => {
      const response = await call('post', '/forms/forms').send({
        siteId: 'not-an-id',
        key: 'visit',
        name: 'ملاقات',
        policy,
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'siteId' });
      const extra = await call('post', `/forms/forms/${ID}/retire`).send({
        version: 1,
        tenantId: 'other',
      });
      expect(extra.status).toBe(400);
      expect(extra.body).toMatchObject({ code: 'request.invalid' });
      const status = await call('get', '/forms/forms?status=archived');
      expect(status.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'status' });
    });

    it('refuses a malformed public submission or tracking request before any use case', async () => {
      const extra = await call('post', '/public/forms/visit/submissions').send({
        answers: {},
        submittedBy: 'someone',
      });
      expect(extra.status).toBe(400);
      expect(extra.body).toMatchObject({ code: 'request.invalid' });
      const captcha = await call('post', '/public/forms/visit/submissions').send({
        answers: {},
        captcha: 'x'.repeat(2049),
      });
      expect(captcha.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'captcha' });
      const tracking = await call('post', '/public/forms/tracking').send({ trackingCode: 1234 });
      expect(tracking.body).toEqual({
        statusCode: 400,
        code: 'request.invalid',
        field: 'trackingCode',
      });
      const inbox = await call('get', `/forms/forms/${ID}/submissions?limit=0`);
      expect(inbox.status).toBe(400);
    });

    it('answers 404 for a path id that is not an id', async () => {
      const form = await call('get', '/forms/forms/visit');
      expect(form.status).toBe(404);
      expect(form.body).toEqual({ statusCode: 404, code: 'forms.form.not-found' });
      const revision = await call('get', '/forms/revisions/1');
      expect(revision.body).toEqual({ statusCode: 404, code: 'forms.form-revision.not-found' });
    });
  });
});
