import { anonymousActor, mintAuthenticatedActor, POPULATIONS, systemActor } from './actor-context';
import type { ActorContext, AuthenticatedActorFields } from './actor-context';
import { parseId } from './id';
import type { Id } from './id';
import { isMinted } from './minted';
import { mintTenantContext, parseTenantId } from './tenant-context';
import type { TenantContext } from './tenant-context';

// Both tenant fixtures (ADR-0002): a test that passes for one tenant only is a bug.
const TENANTS = ['demo-fa', 'demo-en'] as const;

function tenant(code: string): TenantContext {
  const tenantId = parseTenantId(code);
  if (!tenantId.ok) throw new Error('test setup: bad tenant');
  return mintTenantContext(tenantId.value);
}

function id<K extends string>(text: string): Id<K> {
  const parsed = parseId<K>(text);
  if (!parsed.ok) throw new Error(`test setup: bad id ${text}`);
  return parsed.value;
}

const ACCOUNT = id<'Account'>('01890a5d-ac96-774b-bcce-b302099a8057');
const SESSION = id<'Session'>('01890a5d-ac96-774b-bcce-b302099a8058');

const portalUser = (): AuthenticatedActorFields => ({
  population: 'portal-user',
  accountId: ACCOUNT,
  sessionId: SESSION,
});

describe.each(TENANTS)('actors of tenant %s', (code) => {
  const context = tenant(code);

  it.each([
    ['anonymous', anonymousActor],
    ['system', systemActor],
  ] as const)('mints the %s actor with the tenant and nothing else', (kind, build) => {
    const actor = build(context);

    expect(actor).toEqual({ kind, tenantId: code });
    expect(isMinted(actor)).toBe(true);
    expect(Object.isFrozen(actor)).toBe(true);
  });

  it('mints a new value on every call', () => {
    expect(anonymousActor(context)).not.toBe(anonymousActor(context));
  });

  it.each([
    ['a literal', { tenantId: code }],
    ['a spread copy', { ...context }],
    ['a JSON round trip', JSON.parse(JSON.stringify(context)) as unknown],
  ])('refuses %s in place of a minted TenantContext', (_case, forged) => {
    expect(() => anonymousActor(forged as TenantContext)).toThrow(TypeError);
    expect(() => systemActor(forged as TenantContext)).toThrow(TypeError);
  });

  it.each(POPULATIONS)('mints an authenticated actor of the population %s', (population) => {
    const actor = mintAuthenticatedActor(context, { ...portalUser(), population });

    expect(actor).toEqual({ kind: 'authenticated', tenantId: code, ...portalUser(), population });
    expect(isMinted(actor)).toBe(true);
    expect(Object.isFrozen(actor)).toBe(true);
  });

  it.each<[string, Partial<Record<keyof AuthenticatedActorFields, unknown>>]>([
    ['an unknown population', { population: 'staff' }],
    ['a malformed account id', { accountId: 'not-an-id' }],
    ['a malformed session id', { sessionId: '01890A5D-AC96-774B-BCCE-B302099A8058' }],
    ['a token in place of the session id', { sessionId: 'a'.repeat(43) }],
  ])('refuses %s', (_case, override) => {
    expect(() =>
      mintAuthenticatedActor(context, {
        ...portalUser(),
        ...override,
      } as AuthenticatedActorFields),
    ).toThrow(TypeError);
  });

  it('copies only the declared fields: nothing extra travels in the actor', () => {
    const actor = mintAuthenticatedActor(context, {
      ...portalUser(),
      roles: ['admin'],
      email: 'person@example.test',
    } as AuthenticatedActorFields);

    expect(Object.keys(actor).sort()).toEqual(
      ['accountId', 'kind', 'population', 'sessionId', 'tenantId'].sort(),
    );
  });
});

describe('ActorContext', () => {
  it('names the three populations of the platform', () => {
    expect(POPULATIONS).toEqual(['platform-operator', 'tenant-staff', 'portal-user']);
  });

  it('is a closed union on kind: a switch over it is exhaustive', () => {
    const describe = (actor: ActorContext): string => {
      switch (actor.kind) {
        case 'anonymous':
          return 'anonymous';
        case 'system':
          return 'system';
        case 'authenticated':
          return actor.population;
      }
    };

    expect(describe(systemActor(tenant('demo-fa')))).toBe('system');
  });
});
