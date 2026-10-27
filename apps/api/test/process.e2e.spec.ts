import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { JobRegistry } from '../src/platform/scheduler/job-registry';
import { PROCESS_ENGINE } from '../src/modules/process/application/ports/process-engine';
import { UnconfiguredEngine } from '../src/modules/process/infrastructure/unconfigured-engine';
import { createTestApp } from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

// The HTTP edge of the process module (slice 2.2), without a database: every request is
// anonymous, so each route is refused by the gate before any unit of work opens. The bridge
// itself is in test/db/process.db-spec.ts.

const unauthenticated = { statusCode: 401, code: 'access.unauthenticated' };

describe('the process studio API (HTTP)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the relay and sync jobs, and binds no engine without FLOWABLE_*', () => {
    const names = app.get(JobRegistry).names();
    expect(names).toEqual(
      expect.arrayContaining(['process.relay-engine-commands', 'process.sync-engine']),
    );
    expect(app.get(PROCESS_ENGINE)).toBeInstanceOf(UnconfiguredEngine);
  });

  describe.each(TEST_TENANTS)('in tenant %s', (tenant) => {
    const call = (method: 'get' | 'post', path: string) =>
      request(app.getHttpServer())[method](path).set('x-tenant-id', tenant);

    it.each([
      ['post', '/process/revisions', { processKey: 'leave', bpmnXml: '<definitions/>' }],
      ['get', '/process/incidents', undefined],
    ] as const)('refuses an anonymous %s %s with 401', async (method, path, body) => {
      const response = await call(method, path).send(body);
      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it('answers 400 request.invalid with the field for a malformed body or query', async () => {
      const response = await call('post', '/process/revisions').send({
        processKey: 'leave',
        bpmnXml: '<definitions/>',
        tenantId: 'other',
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'request.invalid' });
      const query = await call('get', '/process/incidents?limit=1000');
      expect(query.status).toBe(400);
      expect(query.body).toEqual({ statusCode: 400, code: 'request.invalid', field: 'limit' });
    });
  });
});
