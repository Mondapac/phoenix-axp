import { anonymousActor, systemActor } from './actor-context';
import type { ActorContext } from './actor-context';
import { ContextMismatchError, createCallContext } from './call-context';
import { parseCorrelationId } from './correlation-id';
import type { CorrelationId } from './correlation-id';
import { isMinted } from './minted';
import { mintTenantContext, parseTenantId } from './tenant-context';
import type { TenantContext } from './tenant-context';

/** The reason of the ContextMismatchError `build` throws; fails when it throws anything else. */
function reasonOf(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    if (error instanceof ContextMismatchError) return error.reason;
    throw error;
  }
  throw new Error('expected a ContextMismatchError');
}

const TENANTS = ['demo-fa', 'demo-en'] as const;

function tenant(code: string): TenantContext {
  const tenantId = parseTenantId(code);
  if (!tenantId.ok) throw new Error('test setup: bad tenant');
  return mintTenantContext(tenantId.value);
}

function correlation(text: string): CorrelationId {
  const parsed = parseCorrelationId(text);
  if (!parsed.ok) throw new Error('test setup: bad correlation id');
  return parsed.value;
}

const CORRELATION = correlation('call-context-test-0001');

describe.each(TENANTS)('createCallContext for %s', (code) => {
  const context = tenant(code);
  const other = tenant(code === 'demo-fa' ? 'demo-en' : 'demo-fa');

  it('mints one frozen value holding the very parts it was given', () => {
    const actor = systemActor(context);
    const call = createCallContext(context, actor, CORRELATION);

    expect(isMinted(call)).toBe(true);
    expect(Object.isFrozen(call)).toBe(true);
    expect(call.tenant).toBe(context);
    expect(call.actor).toBe(actor);
    expect(call.correlationId).toBe(CORRELATION);
    expect(Object.keys(call).sort()).toEqual(['actor', 'correlationId', 'tenant']);
  });

  it('refuses an actor of the other tenant: an actor is valid only in its own tenant', () => {
    expect(() => createCallContext(context, anonymousActor(other), CORRELATION)).toThrow(
      ContextMismatchError,
    );
    expect(reasonOf(() => createCallContext(context, systemActor(other), CORRELATION))).toBe(
      'tenant-mismatch',
    );
  });

  it.each([
    ['a literal actor', () => [context, { kind: 'system', tenantId: code }]],
    ['a copied actor', () => [context, { ...systemActor(context) }]],
    ['a literal tenant', () => [{ tenantId: code }, systemActor(context)]],
  ] as const)('refuses %s as not minted', (_case, parts) => {
    const [forgedTenant, forgedActor] = parts();
    expect(
      reasonOf(() =>
        createCallContext(forgedTenant as TenantContext, forgedActor as ActorContext, CORRELATION),
      ),
    ).toBe('not-minted');
  });

  it('refuses a correlation id outside its pattern, as a programmer error', () => {
    expect(() =>
      createCallContext(context, systemActor(context), 'short' as CorrelationId),
    ).toThrow(TypeError);
  });

  it('cannot be copied: a spread or a JSON round trip is not minted', () => {
    const call = createCallContext(context, systemActor(context), CORRELATION);

    expect(isMinted({ ...call })).toBe(false);
    expect(isMinted(JSON.parse(JSON.stringify(call)))).toBe(false);
  });
});
