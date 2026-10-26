import type { ExecutionContext } from '@nestjs/common';
import { BadRequestException, Controller, Get } from '@nestjs/common';
import { isMinted } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import {
  TEST_TENANT_CONFIG_DIRS,
  TEST_TENANT_IDS,
  TEST_TENANTS,
  testTenantId,
} from '../../../test/support/test-config';
import { HealthController } from '../health/health.controller';
import { loadTenantConfigs } from '../tenant-config/tenant-config';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import { attachTenantContext } from './attached-tenant-context';
import { NoTenantContext } from './no-tenant-context.decorator';
import { TenantContextFactory } from './tenant-context.factory';
import * as guardFile from './tenant-context.guard';
import { isTenantContextExempt, TenantContextGuard } from './tenant-context.guard';
import { MissingTenantContextError, tenantContextOf } from './tenant.decorator';

function factoryHosting(codes: readonly string[]): TenantContextFactory {
  return new TenantContextFactory(
    new TenantRegistry(loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, codes.map(testTenantId))),
  );
}

const NOT_HOSTED = { ok: false, error: { code: 'tenant.not-hosted' } };
const INVALID = { ok: false, error: { code: 'tenant-id.invalid' } };

describe('TenantContextFactory', () => {
  const factory = factoryHosting(TEST_TENANTS);

  it.each(TEST_TENANTS)('mints the context of hosted tenant %s', (code) => {
    const result = factory.forTenant(code);

    expect(result).toEqual({ ok: true, value: { tenantId: code } });
    if (!result.ok) throw new Error('unreachable');
    expect(isMinted(result.value)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it.each(TEST_TENANTS)('mints a new context on every call for %s', (code) => {
    const first = factory.forTenant(code);
    const second = factory.forTenant(code);

    expect(first.ok && second.ok && first.value !== second.value).toBe(true);
  });

  it.each(TEST_TENANTS)(
    'in a deployment hosting only %s, refuses the other tenant and serves its own',
    (code) => {
      const single = factoryHosting([code]);

      expect(single.forTenant(code).ok).toBe(true);
      for (const other of TEST_TENANTS.filter((tenant) => tenant !== code)) {
        expect(single.forTenant(other)).toEqual(NOT_HOSTED);
      }
    },
  );

  it('refuses a well-formed tenant that is not hosted, and substitutes no other', () => {
    expect(factory.forTenant('acme')).toEqual(NOT_HOSTED);
  });

  it.each(
    TEST_TENANTS.flatMap((code) => [
      code.toUpperCase(),
      ` ${code}`,
      `${code} `,
      `${code}\n`,
      `${code}_x`,
      `${code}, ${code}`,
      TEST_TENANTS.join(', '),
    ]),
  )('refuses the malformed id %p before asking the registry', (code) => {
    expect(factory.forTenant(code)).toEqual(INVALID);
  });

  it('refuses a value that is not a string at run time', () => {
    expect(factory.forTenant([...TEST_TENANTS] as unknown as string)).toEqual(INVALID);
    expect(factory.forTenant(undefined as unknown as string)).toEqual(INVALID);
  });
});

describe('the TenantContext of a request', () => {
  const factory = factoryHosting(TEST_TENANTS);

  function minted(code: string): TenantContext {
    const result = factory.forTenant(code);
    if (!result.ok) throw new Error(`unreachable: ${result.error.code}`);
    return result.value;
  }

  it.each(TEST_TENANTS)('reads back the very context attached for %s', (code) => {
    const request = {};
    const tenant = minted(code);
    attachTenantContext(request, tenant);

    expect(tenantContextOf(request)).toBe(tenant);
  });

  it('keeps the contexts of two requests apart', () => {
    const [first, second] = [{}, {}];
    const [a, b] = TEST_TENANTS.map(minted);
    attachTenantContext(first, a!);
    attachTenantContext(second, b!);

    expect(tenantContextOf(first)).toBe(a);
    expect(tenantContextOf(second)).toBe(b);
  });

  it('throws when nothing is attached, and never defaults', () => {
    expect(() => tenantContextOf({})).toThrow(MissingTenantContextError);
  });

  it.each(TEST_TENANTS)('refuses a context that was not minted (%s)', (code) => {
    const tenant = minted(code);
    const forgeries = [
      { tenantId: tenant.tenantId },
      { ...tenant },
      JSON.parse(JSON.stringify(tenant)) as unknown,
      Object.freeze({ ...tenant }),
    ] as unknown as TenantContext[];

    for (const forgery of forgeries) {
      const request = {};
      expect(() => attachTenantContext(request, forgery)).toThrow(TypeError);
      expect(() => tenantContextOf(request)).toThrow(MissingTenantContextError);
    }
  });

  it('refuses a second context on the same request', () => {
    const request = {};
    const [first, second] = TEST_TENANTS.map(minted);
    attachTenantContext(request, first!);

    expect(() => attachTenantContext(request, second!)).toThrow(/already/);
    expect(tenantContextOf(request)).toBe(first);
  });

  it.each(TEST_TENANTS)('accepts a context built through /testing for %s (one kernel)', (code) => {
    const request = {};
    const tenant = testTenantContext(code);

    attachTenantContext(request, tenant);
    expect(tenantContextOf(request)).toBe(tenant);
  });
});

@Controller('scoped')
class ScopedController {
  @Get()
  list(): string[] {
    return [];
  }
}

@NoTenantContext()
@Controller('exempt')
class ExemptController {
  @Get()
  ping(): string {
    return 'pong';
  }
}

@Controller('inherits')
class InheritingController extends ExemptController {}

@Controller('method-level')
class MethodLevelController {
  @Get()
  ping(): string {
    return 'pong';
  }
}
// The decorator is typed as a class decorator; forced onto a method it must exempt nothing.
(NoTenantContext() as unknown as MethodDecorator)(
  MethodLevelController.prototype,
  'ping',
  Object.getOwnPropertyDescriptor(MethodLevelController.prototype, 'ping')!,
);

function httpContext(
  controller: object,
  headers: Record<string, string | string[]> = {},
): { context: ExecutionContext; request: object } {
  const request = { headers };
  const context = {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function rejectionOf(guard: TenantContextGuard, context: ExecutionContext): unknown {
  try {
    guard.canActivate(context);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('expected the guard to refuse the request');
}

describe('isTenantContextExempt', () => {
  it('exempts the health controller and a class that carries the decorator', () => {
    expect(isTenantContextExempt(HealthController)).toBe(true);
    expect(isTenantContextExempt(ExemptController)).toBe(true);
  });

  it('exempts nothing else: not a plain controller, a subclass or a method-level use', () => {
    expect(isTenantContextExempt(ScopedController)).toBe(false);
    expect(isTenantContextExempt(InheritingController)).toBe(false);
    expect(isTenantContextExempt(MethodLevelController)).toBe(false);
  });
});

describe('TenantContextGuard', () => {
  const guard = new TenantContextGuard(factoryHosting(TEST_TENANTS));

  it('lets an exempt controller through without a header', () => {
    expect(guard.canActivate(httpContext(ExemptController).context)).toBe(true);
  });

  it.each(TEST_TENANT_IDS)('attaches the context named by x-tenant-id (%s)', (code) => {
    const { context, request } = httpContext(ScopedController, { 'x-tenant-id': code });

    expect(guard.canActivate(context)).toBe(true);
    expect(tenantContextOf(request).tenantId).toBe(code);
  });

  it.each([InheritingController, MethodLevelController, ScopedController])(
    'asks %p for the header',
    (controller) => {
      expect(rejectionOf(guard, httpContext(controller).context)).toEqual({
        statusCode: 400,
        code: 'tenant.header-missing',
      });
    },
  );

  it.each([
    [{ 'x-tenant-id': 'DEMO' }, 'tenant.header-invalid'],
    [{ 'x-tenant-id': ['demo-fa', 'demo-en'] }, 'tenant.header-invalid'],
    [{ 'x-tenant-id': 'demo-fa, demo-en' }, 'tenant.header-invalid'],
    [{ 'x-tenant-id': 'acme' }, 'tenant.not-hosted'],
  ])('refuses %p with %s, never echoing the value', (headers, code) => {
    expect(rejectionOf(guard, httpContext(ScopedController, headers).context)).toEqual({
      statusCode: 400,
      code,
    });
  });

  it('refuses an execution context that is not HTTP', () => {
    const rpc = { ...httpContext(ExemptController).context, getType: () => 'rpc' };

    expect(() => guard.canActivate(rpc as unknown as ExecutionContext)).toThrow(/HTTP/);
  });

  it('exports TenantContextGuard and isTenantContextExempt from its file, and nothing else', () => {
    expect(Object.keys(guardFile).sort()).toEqual(['TenantContextGuard', 'isTenantContextExempt']);
  });
});
