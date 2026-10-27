import { APP_GUARD, ModulesContainer, type ApplicationConfig } from '@nestjs/core';
import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { parseCorrelationId } from '@phoenix/shared-kernel';
import request from 'supertest';
import { AppModule, GLOBAL_GUARDS } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi';
import { ClockModule, CLOCK } from '../src/platform/clock/clock.module';
import { SystemClock } from '../src/platform/clock/system-clock';
import { IdsModule, ID_GENERATOR } from '../src/platform/ids/ids.module';
import { UuidV7IdGenerator } from '../src/platform/ids/uuid-v7-id-generator';
import { ActorGuard } from '../src/platform/call-context/actor.guard';
import { TenantContextFactory } from '../src/platform/tenant-context/tenant-context.factory';
import { TenantContextGuard } from '../src/platform/tenant-context/tenant-context.guard';
import { TenantContextModule } from '../src/platform/tenant-context/tenant-context.module';
import {
  ExemptTenantReaderController,
  TenantEchoController,
} from './support/tenant-test.controllers';
import {
  completionLineOf,
  createTestApp,
  rawGet,
  receivedCount,
  type LogLine,
} from './support/test-app';
import { TEST_TENANTS } from './support/test-config';

const HEADER = 'x-tenant-id';
/** Well formed, hosted by no deployment of the tests. */
const NOT_HOSTED = 'leak-sentinel-tenant';

const missing = { statusCode: 400, code: 'tenant.header-missing' };
const invalid = { statusCode: 400, code: 'tenant.header-invalid' };
const notHosted = { statusCode: 400, code: 'tenant.not-hosted' };

/**
 * Asserts a value reached neither the response nor any log line. The request's own
 * completion line must have been captured first, so the check cannot pass on empty logs.
 */
function expectNowhere(value: string, response: request.Response, logLines: LogLine[]): void {
  completionLineOf(logLines, response.headers['x-correlation-id'] as string);
  expect(response.text).not.toContain(value);
  // The fixed security headers are left out: they are constant text.
  const headers = Object.entries(response.headers).filter(
    ([name]) => name !== 'content-security-policy',
  );
  expect(JSON.stringify(headers)).not.toContain(value);
  expect(JSON.stringify(logLines)).not.toContain(value);
}

// One application per file: nestjs-pino keeps one logger per Jest module registry, so a
// second application here would leave these log assertions without lines.
describe('tenant resolution (HTTP, ADR-0002)', () => {
  let app: NestExpressApplication;
  let logLines: LogLine[];
  const get = (path: string) => request(app.getHttpServer()).get(path);

  beforeAll(async () => {
    ({ app, logLines } = await createTestApp({
      controllers: [TenantEchoController, ExemptTenantReaderController],
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    logLines.length = 0;
  });

  describe('accepted', () => {
    it.each(TEST_TENANTS)('resolves %s and hands the minted context to @Tenant()', async (code) => {
      const response = await get('/test/tenant').set(HEADER, code).expect(200);

      expect(response.body).toEqual({ tenantId: code });
    });

    it.each(TEST_TENANTS)(
      'builds the CallContext of %s: tenant, anonymous actor, generated id',
      async (code) => {
        const response = await get('/test/tenant/call').set(HEADER, code).expect(200);

        expect(response.body).toEqual({
          tenantId: code,
          actor: 'anonymous',
          correlationId: response.headers['x-correlation-id'],
        });
      },
    );

    it.each(TEST_TENANTS)('makes a route tenant-scoped with no opt-in (%s)', async (code) => {
      await get('/test/tenant/call').set(HEADER, code).expect(200);

      const response = await get('/test/tenant/call').expect(400);
      expect(response.body).toEqual(missing);
    });

    it.each(TEST_TENANTS)('refuses an Authorization header with 401 (%s)', async (code) => {
      const response = await get('/test/tenant')
        .set(HEADER, code)
        .set('authorization', 'Bearer leak-sentinel-token')
        .expect(401);

      expect(response.body).toEqual({ statusCode: 401, code: 'session.invalid' });
      expectNowhere('leak-sentinel-token', response, logLines);
    });

    it.each(TEST_TENANTS)(
      'returns a generated correlation id that passes parseCorrelationId (%s)',
      async (code) => {
        const accepted = await get('/test/tenant').set(HEADER, code).expect(200);
        const refused = await get('/test/tenant').set(HEADER, code.toUpperCase()).expect(400);

        for (const response of [accepted, refused]) {
          expect(parseCorrelationId(response.headers['x-correlation-id'] as string).ok).toBe(true);
        }
      },
    );

    it.each(TEST_TENANTS)(
      'never takes a UUID-shaped caller correlation id as the request id (%s)',
      async (code) => {
        const inbound = '0b5e3a8c-6c1e-4d7a-9f2b-1a2b3c4d5e6f';
        const response = await get('/test/tenant')
          .set(HEADER, code)
          .set('x-correlation-id', inbound)
          .expect(200);

        const generated = response.headers['x-correlation-id'] as string;
        expect(generated).not.toBe(inbound);
        expect(logLines.filter((line) => line.correlationId === inbound)).toEqual([]);
        const carrying = logLines.filter((line) => line.clientRequestId === inbound);
        expect(carrying).toHaveLength(1);
        expect(carrying[0]).toBe(completionLineOf(logLines, generated));
      },
    );
  });

  describe('refused with 400 and the code only', () => {
    it('answers tenant.header-missing when the header is absent', async () => {
      const response = await get('/test/tenant').expect(400);

      expect(response.body).toEqual(missing);
    });

    it.each(
      TEST_TENANTS.flatMap((code) => [
        code.toUpperCase(),
        `${code}_LEAK`,
        `${code}-${'x'.repeat(32)}`,
        `LEAK-${code}-sentinel`,
        `${code};${code}`,
      ]),
    )('answers tenant.header-invalid to %p without echoing or logging it', async (value) => {
      const response = await get('/test/tenant').set(HEADER, value).expect(400);

      expect(response.body).toEqual(invalid);
      expectNowhere(value, response, logLines);
    });

    it('answers tenant.header-invalid to an empty header', async () => {
      const response = await get('/test/tenant').set(HEADER, '').expect(400);

      expect(response.body).toEqual(invalid);
    });

    it.each([
      [TEST_TENANTS[0], TEST_TENANTS[1]],
      [TEST_TENANTS[1], TEST_TENANTS[0]],
      [TEST_TENANTS[0], TEST_TENANTS[0]],
      [TEST_TENANTS[1], TEST_TENANTS[1]],
    ])('answers tenant.header-invalid to a repeated header (%s, %s)', async (first, second) => {
      // Two real header lines, sent with Node's own client; Node joins them on receipt.
      const response = await rawGet(app, '/test/tenant', { [HEADER]: [first, second] });

      expect(receivedCount(response, HEADER)).toBe(2);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.text)).toEqual(invalid);
    });

    it('answers tenant.not-hosted to a well-formed tenant this deployment does not host', async () => {
      const response = await get('/test/tenant').set(HEADER, NOT_HOSTED).expect(400);

      expect(response.body).toEqual(notHosted);
      expectNowhere(NOT_HOSTED, response, logLines);
    });

    it('logs a refusal once, as the completion line, with no header value', async () => {
      await get('/test/tenant').set(HEADER, NOT_HOSTED).expect(400);

      expect(logLines).toHaveLength(1);
      expect(logLines[0]).toMatchObject({
        msg: 'request completed',
        req: { method: 'GET', url: '/test/tenant' },
        res: { statusCode: 400 },
      });
    });
  });

  describe('exempt and unrouted paths', () => {
    it('serves /health without the header', async () => {
      await get('/health').expect(200);
    });

    it('serves /health/ready without the header (503 here: no database)', async () => {
      await get('/health/ready').expect(503);
    });

    it('answers an unknown route with 404, not with a tenant error', async () => {
      const response = await get('/no-such-route').expect(404);

      expect(response.body).not.toHaveProperty('code');
    });

    it.each(TEST_TENANTS)(
      '@Tenant() throws on an exempt controller instead of defaulting (%s)',
      async (code) => {
        const withHeader = await get('/test/exempt').set(HEADER, code).expect(500);
        const withoutHeader = await get('/test/exempt').expect(500);

        for (const response of [withHeader, withoutHeader]) {
          expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
        }
      },
    );
  });

  describe('composition root', () => {
    it('registers TenantContextGuard and ActorGuard, in order, in AppModule only', () => {
      expect(GLOBAL_GUARDS).toEqual([TenantContextGuard, ActorGuard]);

      const declared: { module: string; guard: unknown }[] = [];
      for (const moduleRef of app.get(ModulesContainer).values()) {
        for (const collection of [moduleRef.providers, moduleRef.injectables]) {
          for (const [token, wrapper] of collection) {
            if (typeof token === 'string' && token.startsWith(APP_GUARD)) {
              declared.push({ module: moduleRef.metatype.name, guard: wrapper.metatype });
            }
          }
        }
      }
      expect(declared).toEqual(GLOBAL_GUARDS.map((guard) => ({ module: AppModule.name, guard })));
    });

    it('runs exactly the guards of GLOBAL_GUARDS, in order (no useGlobalGuards anywhere)', () => {
      // The application's own list of global guards, after configureApp: what really runs.
      const running = (app as unknown as { config: ApplicationConfig }).config.getGlobalGuards();

      expect(running.map((guard) => guard.constructor)).toEqual([...GLOBAL_GUARDS]);
    });

    it('binds the real clock and id generator', () => {
      expect(app.get(CLOCK)).toBeInstanceOf(SystemClock);
      expect(app.get(ID_GENERATOR)).toBeInstanceOf(UuidV7IdGenerator);
    });

    it.each([
      [ClockModule, [CLOCK]],
      [IdsModule, [ID_GENERATOR]],
      [TenantContextModule, [TenantContextFactory]],
    ])('makes %p global and exports its token or factory only', (module, exported) => {
      expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, module)).toBe(true);
      expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, module)).toEqual(exported);
    });
  });

  describe('OpenAPI', () => {
    type Operation = { operationId?: string; parameters?: { name?: string; in?: string }[] };

    function operations(): [string, Operation][] {
      return Object.entries(buildOpenApiDocument(app).paths).flatMap(([path, item]) =>
        Object.entries(item as Record<string, Operation>).map(
          ([method, operation]) =>
            [`${method.toUpperCase()} ${path}`, operation] as [string, Operation],
        ),
      );
    }

    const tenantHeader = (operation: Operation) =>
      operation.parameters?.find(
        (parameter) => parameter.in === 'header' && parameter.name === HEADER,
      );

    it('gives every operation a unique id', () => {
      const ids = operations().map(([, operation]) => operation.operationId);

      expect(ids).not.toContain(undefined);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('documents x-tenant-id as required on tenant-scoped operations only', () => {
      const byName = new Map(operations());

      expect(tenantHeader(byName.get('GET /health')!)).toBeUndefined();
      expect(tenantHeader(byName.get('GET /health/ready')!)).toBeUndefined();
      expect(tenantHeader(byName.get('GET /test/exempt')!)).toBeUndefined();
      for (const name of ['GET /test/tenant', 'GET /test/tenant/call']) {
        expect(tenantHeader(byName.get(name)!)).toMatchObject({ in: 'header', required: true });
      }
    });
  });
});
