// Phoenix ADR-0010 decisions 2 and 4: the two fail-closed placeholders of platform/authz are
// marked, constant, and refuse; the module binds them while no implementing module is given.
import { Global, Injectable, Module } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { parseId } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import {
  testAuthenticatedActor,
  testCallContext,
  testTenantContext,
} from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../test/support/test-config';
import { containerPlaceholders } from '../../placeholders/bound-placeholders';
import { TenantRegistry } from '../../tenant-config/tenant-registry';
import {
  AUTHORISATION_CHECK,
  type AccessDecision,
  type AuthorisationCheck,
} from '../authorisation-check';
import { AuthzModule } from '../authz.module';
import { FIELD_RULE_READER } from '../field-policy';
import { SITE_ANCESTRY_READER, type SiteAncestryReader } from '../site-scope';
import { USE_CASE_GATE } from '../use-case-gate.token';
import { placeholderMarkOf } from '../../placeholders/placeholder-markers';
import { AUTHENTICATOR } from '../authenticator';
import { FailClosedAuthenticator } from './fail-closed-authenticator';
import { FailClosedAuthorisationCheck } from './fail-closed-authorisation-check';
import { FailClosedFieldRuleReader } from './fail-closed-field-rule-reader';
import { FailClosedSiteAncestryReader } from './fail-closed-site-ancestry-reader';

const id = <K extends string>(n: number): Id<K> => {
  const parsed = parseId<K>(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value;
};

describe.each(TEST_TENANTS)('the authz placeholders in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const staff = testCallContext(
    tenant,
    testAuthenticatedActor(tenant, {
      population: 'tenant-staff',
      accountId: id<'Account'>(1),
      sessionId: id<'Session'>(2),
    }),
  );

  it('refuses every authorisation question with access.unavailable', async () => {
    const check: AuthorisationCheck = new FailClosedAuthorisationCheck();
    await expect(
      check.check(staff, { name: 'identity.x', rule: { kind: 'own-resources' } }),
    ).resolves.toEqual({ allowed: false, denial: { code: 'access.unavailable' } });
  });

  it('rejects every session', async () => {
    await expect(new FailClosedAuthenticator().authenticate()).resolves.toEqual({
      ok: false,
      error: { code: 'credential.rejected' },
    });
  });

  it('answers no field grant, so every field is hidden', async () => {
    await expect(new FailClosedFieldRuleReader().grantsFor()).resolves.toEqual([]);
  });

  it('answers that no site exists or is within any subtree', async () => {
    const reader: SiteAncestryReader = new FailClosedSiteAncestryReader();
    await expect(reader.isWithinSubtree(staff, id(3), id(4))).resolves.toBe(false);
    await expect(reader.siteExists(staff, id(3))).resolves.toBe(false);
  });
});

describe('the placeholder marks', () => {
  it('names the port each placeholder stands in for', () => {
    expect(placeholderMarkOf(FailClosedAuthorisationCheck)).toMatchObject({
      port: 'identity.authorisationCheck',
    });
    expect(placeholderMarkOf(FailClosedAuthenticator)).toMatchObject({
      port: 'identity.authenticator',
    });
    expect(placeholderMarkOf(FailClosedFieldRuleReader)).toMatchObject({
      port: 'identity.fieldRuleReader',
    });
    expect(placeholderMarkOf(FailClosedSiteAncestryReader)).toMatchObject({
      port: 'tenancy.isWithinSubtree',
    });
  });
});

@Global()
@Module({
  providers: [{ provide: TenantRegistry, useValue: new TenantRegistry(new Map()) }],
  exports: [TenantRegistry],
})
class TestTenants {}

@Injectable()
class RealCheck {
  check(): Promise<AccessDecision> {
    return Promise.resolve({ allowed: true });
  }
}
@Injectable()
class RealAuthenticator {
  authenticate(): Promise<never> {
    return Promise.reject(new Error('not called'));
  }
}
@Injectable()
class RealFieldRules {
  grantsFor(): Promise<never[]> {
    return Promise.resolve([]);
  }
}
@Module({
  providers: [
    { provide: AUTHORISATION_CHECK, useClass: RealCheck },
    { provide: AUTHENTICATOR, useClass: RealAuthenticator },
    { provide: FIELD_RULE_READER, useClass: RealFieldRules },
  ],
  exports: [AUTHORISATION_CHECK, AUTHENTICATOR, FIELD_RULE_READER],
})
class IdentityStandIn {}

@Injectable()
class RealReader {
  siteExists(): Promise<boolean> {
    return Promise.resolve(true);
  }
  isWithinSubtree(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
@Module({
  providers: [{ provide: SITE_ANCESTRY_READER, useClass: RealReader }],
  exports: [SITE_ANCESTRY_READER],
})
class TenancyStandIn {}

describe('AuthzModule.register', () => {
  const ports = async (bindings: Parameters<typeof AuthzModule.register>[0]) => {
    const app = await Test.createTestingModule({
      imports: [TestTenants, AuthzModule.register(bindings)],
    }).compile();
    const found = containerPlaceholders(app.get(ModulesContainer)).map((p) => p.port);
    const gate: unknown = app.get(USE_CASE_GATE);
    await app.close();
    return { found: [...new Set(found)].sort(), gate };
  };

  it('binds every fail-closed placeholder while no implementing module is given', async () => {
    const { found, gate } = await ports({});
    expect(found).toEqual([
      'identity.authenticator',
      'identity.authorisationCheck',
      'identity.fieldRuleReader',
      'tenancy.isWithinSubtree',
    ]);
    expect(gate).toBeDefined();
  });

  it('binds no placeholder once identity and tenancy provide the ports', async () => {
    const { found } = await ports({
      authentication: IdentityStandIn,
      authorisation: IdentityStandIn,
      fieldRules: IdentityStandIn,
      siteAncestry: TenancyStandIn,
    });
    expect(found).toEqual([]);
  });
});
