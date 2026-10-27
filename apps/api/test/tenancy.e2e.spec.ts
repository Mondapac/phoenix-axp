import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { SITE_ANCESTRY_READER } from '../src/platform/authz';
import { containerPlaceholders } from '../src/platform/placeholders/bound-placeholders';
import { ClosureSiteAncestryReader } from '../src/modules/tenancy/infrastructure/site-ancestry.reader';
import { createTestApp } from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

// The HTTP edge of the tenancy module (slice 1.4), without a database: until identity binds a
// session, every request is anonymous, so each studio route is refused by the gate before any
// unit of work opens. The database behaviour is in test/db/tenancy.db-spec.ts.

const unauthenticated = { statusCode: 401, code: 'access.unauthenticated' };

describe('the tenancy studio API (HTTP)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('binds its closure-table reader as the site-ancestry port, leaving no authz placeholder', () => {
    expect(app.get(SITE_ANCESTRY_READER)).toBeInstanceOf(ClosureSiteAncestryReader);
    const ports = containerPlaceholders(app.get(ModulesContainer)).map((p) => p.port);
    expect([...new Set(ports)]).toEqual([]);
  });

  describe.each(TEST_TENANTS)('in tenant %s', (tenant) => {
    const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
      request(app.getHttpServer())[method](path).set('x-tenant-id', tenant);
    const SITE = '01890a5d-ac96-774b-bcce-b302099a8057';

    it.each([
      ['get', '/tenancy/sites', undefined],
      ['get', `/tenancy/sites/${SITE}`, undefined],
      [
        'post',
        '/tenancy/sites',
        { parentSiteId: null, organizationId: null, slug: 'fars', name: 'فارس' },
      ],
      ['patch', `/tenancy/sites/${SITE}`, { version: 1, name: 'x', organizationId: null }],
      ['post', `/tenancy/sites/${SITE}/move`, { newParentSiteId: null }],
      ['post', `/tenancy/sites/${SITE}/domains`, { hostname: 'fars.example.ir' }],
      ['delete', `/tenancy/site-domains/${SITE}`, undefined],
      ['get', '/tenancy/organizations', undefined],
      ['post', '/tenancy/organizations', { parentId: null, name: 'x' }],
      ['get', '/tenancy/settings', undefined],
      ['put', '/tenancy/settings', { version: 1, signInSources: ['local'], maxSiteDepth: 8 }],
    ] as const)('refuses an anonymous %s %s with 401', async (method, path, body) => {
      const response = await call(method, path).send(body);
      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it('answers 400 request.invalid with the field for a malformed body', async () => {
      const response = await call('post', '/tenancy/sites').send({
        parentSiteId: 'not-an-id',
        organizationId: null,
        slug: 'fars',
        name: 'فارس',
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        statusCode: 400,
        code: 'request.invalid',
        field: 'parentSiteId',
      });
      const extra = await call('post', '/tenancy/organizations').send({
        parentId: null,
        name: 'x',
        tenantId: 'other',
      });
      expect(extra.status).toBe(400);
      expect(extra.body).toMatchObject({ code: 'request.invalid' });
    });

    it('answers 404 for a path id that is not an id', async () => {
      const response = await call('get', '/tenancy/sites/fars');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ statusCode: 404, code: 'tenancy.site.not-found' });
    });
  });

  it('refuses a request without a tenant before any route', async () => {
    const response = await request(app.getHttpServer()).get('/tenancy/sites');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ statusCode: 400, code: 'tenant.header-missing' });
  });
});
