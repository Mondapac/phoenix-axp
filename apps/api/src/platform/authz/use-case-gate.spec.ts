// Ported from Mondapac apps/api/src/platform/authz/use-case-gate.spec.ts. Phoenix: Tenant for
// Market, the three populations of ADR-0019, no seller state; the gate takes the permission
// registry, and the unknown-key and population cases are added.
import { Logger } from '@nestjs/common';
import { isMinted, parseId } from '@phoenix/shared-kernel';
import type { CallContext, Id, Population, TenantContext } from '@phoenix/shared-kernel';
import {
  testAuthenticatedActor,
  testCallContext,
  testTenantContext,
} from '@phoenix/shared-kernel/testing';
import { TEST_TENANT_IDS, TEST_TENANTS, testTenantId } from '../../../test/support/test-config';
import type { TenantConfig } from '../tenant-config/tenant-config';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import type { AccessDeclaration, PermissionKey } from './access-rule';
import type { AccessDecision, AuthorisationCheck } from './authorisation-check';
import { definePermission, type PermissionDeclaration } from './permission';
import { createUseCaseGate, isUseCaseGate, UseCaseGate } from './use-case-gate';

// identity design 5.2 ("Wrapper"), 5.1 (anonymous, HF9), HF4; foundations 6.2 to 6.4.

const registryHosting = (codes: readonly string[]) =>
  new TenantRegistry(new Map(codes.map((code) => [testTenantId(code), {} as TenantConfig])));

const id = <K extends string>(text: string): Id<K> => {
  const parsed = parseId<K>(text);
  if (!parsed.ok) throw new Error('test setup: bad id');
  return parsed.value;
};
const ACCOUNT = id<'Account'>('01890a5d-ac96-774b-bcce-b302099a8057');
const SESSION = id<'Session'>('01890a5d-ac96-774b-bcce-b302099a8058');
const KEY = 'identity.member.view' as PermissionKey;
const PLATFORM_KEY = 'identity.tenant.suspend' as PermissionKey;
const SITE_KEY = 'content.page.publish' as PermissionKey;
const UNKNOWN_KEY = 'identity.member.delete' as PermissionKey;

/** The registry the gate reads: the declared keys of the tests, and nothing else. */
const DECLARED = new Map<string, PermissionDeclaration>(
  [
    definePermission('identity', { key: KEY, scope: 'tenant', protected: false }),
    definePermission('identity', { key: PLATFORM_KEY, scope: 'platform', protected: true }),
    definePermission('content', { key: SITE_KEY, scope: 'site', protected: false }),
  ].map((declaration) => [declaration.key, declaration]),
);
const PERMISSIONS_DECLARED = { get: (key: string) => DECLARED.get(key) };

/** A use-case class with its own declaration: the gate reads only `access`. */
function useCaseWith(access: unknown): abstract new () => unknown {
  const useCase = class {};
  Object.defineProperty(useCase, 'access', { value: access, enumerable: true });
  return useCase;
}

const SYSTEM_ONLY = useCaseWith({ name: 'identity.purge-expired', rule: { kind: 'system' } });
const ANONYMOUS = useCaseWith({ name: 'identity.sign-in', rule: { kind: 'anonymous' } });
const OWN = useCaseWith({
  name: 'identity.change-password',
  rule: { kind: 'own-resources' },
});
const PERMISSIONS = useCaseWith({
  name: 'identity.list-members',
  rule: { kind: 'permissions', allOf: [KEY] },
});

class RecordingCheck implements AuthorisationCheck {
  readonly calls: { context: CallContext; declaration: AccessDeclaration }[] = [];
  constructor(private readonly answer: () => Promise<AccessDecision>) {}
  check(context: CallContext, declaration: AccessDeclaration): Promise<AccessDecision> {
    this.calls.push({ context, declaration });
    return this.answer();
  }
}

const ALLOW = () => Promise.resolve<AccessDecision>({ allowed: true });

describe.each(TEST_TENANTS)('UseCaseGate in tenant %s', (code) => {
  const tenant: TenantContext = testTenantContext(code);
  const authenticated = (population: Population = 'tenant-staff') =>
    testCallContext(
      tenant,
      testAuthenticatedActor(tenant, {
        population,
        accountId: ACCOUNT,
        sessionId: SESSION,
      }),
    );
  let warnings: jest.SpyInstance;
  let errors: jest.SpyInstance;

  beforeEach(() => {
    warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnings.mockRestore();
    errors.mockRestore();
  });

  const gateWith = (check: AuthorisationCheck | null = new RecordingCheck(ALLOW)) =>
    createUseCaseGate(registryHosting(TEST_TENANT_IDS), PERMISSIONS_DECLARED, check);

  describe('the system rule', () => {
    it('admits the system actor, with the very context it received', async () => {
      const context = testCallContext(tenant, 'system');

      await expect(gateWith().admit(SYSTEM_ONLY, context)).resolves.toEqual({
        ok: true,
        value: context,
      });
    });

    it.each(['anonymous', 'authenticated'] as const)(
      'refuses the %s actor with access.denied',
      async (kind) => {
        const context = kind === 'anonymous' ? testCallContext(tenant, kind) : authenticated();

        await expect(gateWith().admit(SYSTEM_ONLY, context)).resolves.toEqual({
          ok: false,
          error: { code: 'access.denied' },
        });
      },
    );
  });

  describe('the anonymous rule (5.1, HF9)', () => {
    it('admits the anonymous actor unchanged', async () => {
      const context = testCallContext(tenant, 'anonymous');

      await expect(gateWith().admit(ANONYMOUS, context)).resolves.toEqual({
        ok: true,
        value: context,
      });
    });

    it.each(['platform-operator', 'tenant-staff', 'portal-user'] as const)(
      "admits a signed-in %s but hands the use case the tenant's anonymous actor",
      async (population) => {
        const check = new RecordingCheck(ALLOW);
        const context = authenticated(population);

        const result = await gateWith(check).admit(ANONYMOUS, context);

        if (!result.ok) throw new Error('expected admission');
        expect(result.value).not.toBe(context);
        expect(isMinted(result.value)).toBe(true);
        expect(result.value.actor).toEqual({ kind: 'anonymous', tenantId: code });
        expect(result.value.tenant).toBe(tenant);
        expect(result.value.correlationId).toBe(context.correlationId);
        expect(check.calls).toEqual([]);
      },
    );

    it('never admits the system actor', async () => {
      await expect(gateWith().admit(ANONYMOUS, testCallContext(tenant, 'system'))).resolves.toEqual(
        { ok: false, error: { code: 'access.denied' } },
      );
    });
  });

  describe.each([
    ['own-resources', OWN],
    ['permissions', PERMISSIONS],
  ])('the %s rule', (_kind, useCase) => {
    it('refuses the anonymous actor with access.unauthenticated, without asking the check', async () => {
      const check = new RecordingCheck(ALLOW);

      await expect(
        gateWith(check).admit(useCase, testCallContext(tenant, 'anonymous')),
      ).resolves.toEqual({ ok: false, error: { code: 'access.unauthenticated' } });
      expect(check.calls).toEqual([]);
    });

    it('refuses the system actor with access.denied', async () => {
      await expect(gateWith().admit(useCase, testCallContext(tenant, 'system'))).resolves.toEqual({
        ok: false,
        error: { code: 'access.denied' },
      });
    });

    it('asks the check for an authenticated actor, with the context and the declaration', async () => {
      const check = new RecordingCheck(ALLOW);
      const context = authenticated();

      await expect(gateWith(check).admit(useCase, context)).resolves.toEqual({
        ok: true,
        value: context,
      });
      expect(check.calls).toEqual([
        { context, declaration: (useCase as unknown as { access: AccessDeclaration }).access },
      ]);
    });

    it.each<[string, AccessDecision]>([
      ['access.denied', { allowed: false, denial: { code: 'access.denied' } }],
      ['access.unavailable', { allowed: false, denial: { code: 'access.unavailable' } }],
    ])("passes on the check's %s", async (_code, decision) => {
      const result = await gateWith(new RecordingCheck(() => Promise.resolve(decision))).admit(
        useCase,
        authenticated(),
      );

      expect(result).toEqual({ ok: false, error: decision.allowed ? null : decision.denial });
    });

    it.each<[string, () => Promise<AccessDecision>]>([
      ['throws', () => Promise.reject(new Error('database down'))],
      ['answers something else', () => Promise.resolve({ allowed: 'yes' } as never)],
      [
        'answers access.unauthenticated',
        () =>
          Promise.resolve({ allowed: false, denial: { code: 'access.unauthenticated' } } as never),
      ],
      [
        'answers a code the port does not allow',
        () =>
          Promise.resolve({
            allowed: false,
            denial: { code: 'access.seller-not-approved', details: { state: 'approved' } },
          } as never),
      ],
    ])('fails closed with access.unavailable when the check %s', async (_case, answer) => {
      await expect(
        gateWith(new RecordingCheck(answer)).admit(useCase, authenticated()),
      ).resolves.toEqual({ ok: false, error: { code: 'access.unavailable' } });
    });

    it('fails closed with access.unavailable while no check is bound', async () => {
      await expect(gateWith(null).admit(useCase, authenticated())).resolves.toEqual({
        ok: false,
        error: { code: 'access.unavailable' },
      });
    });
  });

  describe('before any rule is decided', () => {
    it('reads the declaration only as an own property: a subclass never inherits it (HF4)', async () => {
      const Parent = useCaseWith({ name: 'identity.parent', rule: { kind: 'system' } });
      class Child extends (Parent as unknown as new () => object) {}

      await expect(gateWith().admit(Child, testCallContext(tenant, 'system'))).resolves.toEqual({
        ok: false,
        error: { code: 'access.denied' },
      });
    });

    it.each<[string, unknown]>([
      ['no declaration', undefined],
      ['an unknown rule kind', { name: 'identity.x', rule: { kind: 'any-of' } }],
      ['an empty allOf', { name: 'identity.x', rule: { kind: 'permissions', allOf: [] } }],
      ['a malformed key', { name: 'identity.x', rule: { kind: 'permissions', allOf: ['Admin'] } }],
      [
        "Mondapac's seller-state attribute",
        { name: 'identity.x', rule: { kind: 'own-resources' }, whenSellerNotApproved: 'deny' },
      ],
      ['an extra field', { name: 'identity.x', rule: { kind: 'system' }, bypass: true }],
      ['a malformed name', { name: 'Identity X', rule: { kind: 'system' } }],
    ])('refuses %s with access.denied', async (_case, access) => {
      await expect(
        gateWith().admit(useCaseWith(access), testCallContext(tenant, 'system')),
      ).resolves.toEqual({ ok: false, error: { code: 'access.denied' } });
    });

    it('refuses a context that was not minted, whatever the rule', async () => {
      const minted = testCallContext(tenant, 'system');
      for (const forged of [{ ...minted }, JSON.parse(JSON.stringify(minted)) as unknown]) {
        await expect(gateWith().admit(SYSTEM_ONLY, forged as CallContext)).resolves.toEqual({
          ok: false,
          error: { code: 'access.denied' },
        });
        await expect(gateWith().admit(ANONYMOUS, forged as CallContext)).resolves.toEqual({
          ok: false,
          error: { code: 'access.denied' },
        });
      }
    });

    it('refuses a tenant this deployment does not host', async () => {
      const others = TEST_TENANTS.filter((other) => other !== code);
      const gate = createUseCaseGate(
        registryHosting(others),
        PERMISSIONS_DECLARED,
        new RecordingCheck(ALLOW),
      );

      await expect(gate.admit(SYSTEM_ONLY, testCallContext(tenant, 'system'))).resolves.toEqual({
        ok: false,
        error: { code: 'access.denied' },
      });
    });

    it('turns an exception inside the gate into access.unavailable', async () => {
      const broken = new TenantRegistry(new Map());
      jest.spyOn(broken, 'isHosted').mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(
        createUseCaseGate(broken, PERMISSIONS_DECLARED, null).admit(
          SYSTEM_ONLY,
          testCallContext(tenant, 'system'),
        ),
      ).resolves.toEqual({ ok: false, error: { code: 'access.unavailable' } });
    });
  });

  describe('the permissions rule, before the check is asked (ADR-0004 decision 6, ADR-0019)', () => {
    const permissionsOf = (allOf: readonly PermissionKey[]) =>
      useCaseWith({ name: 'identity.x', rule: { kind: 'permissions', allOf } });

    it('refuses a key the registry does not declare: an unknown key grants nothing', async () => {
      const check = new RecordingCheck(ALLOW);

      await expect(
        gateWith(check).admit(permissionsOf([KEY, UNKNOWN_KEY]), authenticated()),
      ).resolves.toEqual({ ok: false, error: { code: 'access.denied' } });
      expect(check.calls).toEqual([]);
      expect(warnings).toHaveBeenCalledWith(expect.objectContaining({ reason: 'key-unknown' }));
    });

    it.each<[string, PermissionKey, Population]>([
      ['a tenant key', KEY, 'tenant-staff'],
      ['a site key', SITE_KEY, 'tenant-staff'],
      ['a platform key', PLATFORM_KEY, 'platform-operator'],
    ])('asks the check for %s held by its population (%s)', async (_case, key, population) => {
      const check = new RecordingCheck(ALLOW);

      const result = await gateWith(check).admit(permissionsOf([key]), authenticated(population));

      expect(result.ok).toBe(true);
      expect(check.calls).toHaveLength(1);
    });

    it.each<[string, PermissionKey, Population]>([
      ['a platform key to tenant staff', PLATFORM_KEY, 'tenant-staff'],
      ['a tenant key to a platform operator', KEY, 'platform-operator'],
      ['a tenant key to a portal user', KEY, 'portal-user'],
      ['a site key to a portal user', SITE_KEY, 'portal-user'],
      ['a platform key to a portal user', PLATFORM_KEY, 'portal-user'],
    ])('refuses %s without asking the check', async (_case, key, population) => {
      const check = new RecordingCheck(ALLOW);

      await expect(
        gateWith(check).admit(permissionsOf([key]), authenticated(population)),
      ).resolves.toEqual({ ok: false, error: { code: 'access.denied' } });
      expect(check.calls).toEqual([]);
      expect(warnings).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'population-mismatch' }),
      );
    });

    it('lets a portal user through to the check under own-resources', async () => {
      const check = new RecordingCheck(ALLOW);

      await expect(gateWith(check).admit(OWN, authenticated('portal-user'))).resolves.toMatchObject(
        { ok: true },
      );
      expect(check.calls).toHaveLength(1);
    });
  });

  describe('logging (5.2: every denial with use case, rule, actor id and correlation id)', () => {
    it('logs a denial with those fields and nothing of the input', async () => {
      const context = authenticated();

      await gateWith(
        new RecordingCheck(() =>
          Promise.resolve({ allowed: false, denial: { code: 'access.denied' } }),
        ),
      ).admit(PERMISSIONS, context);

      expect(warnings).toHaveBeenCalledWith({
        msg: 'access.denied',
        useCase: 'identity.list-members',
        rule: 'permissions',
        keys: [KEY],
        actor: 'authenticated',
        actorId: ACCOUNT,
        tenantId: code,
        correlationId: context.correlationId,
        reason: 'check-denied',
        code: 'access.denied',
      });
    });

    it('logs a denial of an unknown use case without reading its parts', async () => {
      await gateWith().admit(useCaseWith(undefined), testCallContext(tenant, 'system'));

      expect(warnings).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'access.denied',
          useCase: null,
          reason: 'declaration-missing',
          actor: 'system',
          actorId: null,
        }),
      );
    });

    it('logs no line when it admits', async () => {
      await gateWith().admit(SYSTEM_ONLY, testCallContext(tenant, 'system'));

      expect(warnings).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
    });
  });
});

describe('UseCaseGate is final and minted (M1)', () => {
  it('cannot be subclassed: a subclass could replace the decision', () => {
    class Lenient extends UseCaseGate {}

    expect(
      () =>
        new Lenient(
          Symbol('forged') as never,
          registryHosting(TEST_TENANT_IDS),
          PERMISSIONS_DECLARED,
          null,
        ),
    ).toThrow(TypeError);
  });

  it("cannot be built without the private key, even from a real gate's constructor", () => {
    const real = createUseCaseGate(registryHosting(TEST_TENANT_IDS), PERMISSIONS_DECLARED, null);
    const Gate = real.constructor as new (...args: unknown[]) => UseCaseGate;

    expect(
      () =>
        new Gate(
          Symbol('UseCaseGate.construction'),
          registryHosting([]),
          PERMISSIONS_DECLARED,
          null,
        ),
    ).toThrow(/built by platform\/authz/);
    expect(() => new Gate(undefined, registryHosting([]), PERMISSIONS_DECLARED, null)).toThrow(
      TypeError,
    );
  });

  it('recognises only the gates its factory built', () => {
    const real = createUseCaseGate(registryHosting(TEST_TENANT_IDS), PERMISSIONS_DECLARED, null);
    const lookalike = Object.create(UseCaseGate.prototype) as unknown;

    expect(isUseCaseGate(real)).toBe(true);
    expect(isUseCaseGate(lookalike)).toBe(false);
    expect(isUseCaseGate({ admit: () => undefined })).toBe(false);
    expect(isUseCaseGate(null)).toBe(false);
  });
});
