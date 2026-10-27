// Adapted from Mondapac apps/api/src/modules/identity/domain/grant-policy.spec.ts (identity design
// 5.5): the same subset, system-role and protected-key rules, with Phoenix's populations and
// scopes. Phoenix additions: a portal user never holds a staff or operator role (ADR-0019
// decision 2); a grant sits at its role's level; a site grantor grants only within its own
// subtree, and access flows only downward (ADR-0018 decision 6).
import { parseId } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import type { SiteRelation } from '../site-scope';
import {
  GrantPolicy,
  type ActedOnAccount,
  type GrantedRole,
  type GrantingActor,
  type GrantPlacement,
} from './grant-policy';
import type { GrantScope } from './role-model';

const id = <T extends string>(n: number): Id<T> => {
  const parsed = parseId(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value as Id<T>;
};

const PROTECTED = new Set(['identity.tenant.suspend', 'identity.member.invite']);
const catalogue = { isProtected: (key: string) => PROTECTED.has(key) };

const PLATFORM_KEYS = ['identity.tenant.view', 'identity.tenant.suspend'];
const TENANT_KEYS = [
  'identity.member.view',
  'identity.member.invite',
  'content.page.edit',
  'content.page.publish',
];

const OPERATOR_SYSTEM = id<'Role'>(1);
const TENANT_SYSTEM = id<'Role'>(2);
const EDITOR = id<'Role'>(3);
const SITE_EDITOR = id<'Role'>(4);

// A site tree of the demo tenants: HQ > Region > Branch, and a sibling region.
const HQ = id<'Site'>(500);
const REGION = id<'Site'>(501);
const BRANCH = id<'Site'>(502);
const OTHER_REGION = id<'Site'>(503);

const site = (siteId: Id<'Site'>, includeDescendants = false): GrantScope => ({
  level: 'site',
  siteId,
  includeDescendants,
});
const TENANT: GrantScope = { level: 'tenant' };
const PLATFORM: GrantScope = { level: 'platform' };

const operator: GrantingActor = {
  accountId: id<'Account'>(101),
  population: 'platform-operator',
  roleId: OPERATOR_SYSTEM,
  roleScope: 'platform',
  holdsSystemRole: true,
  scope: PLATFORM,
  effectiveKeys: new Set(PLATFORM_KEYS),
};
const tenantOwner: GrantingActor = {
  accountId: id<'Account'>(201),
  population: 'tenant-staff',
  roleId: TENANT_SYSTEM,
  roleScope: 'tenant',
  holdsSystemRole: true,
  scope: TENANT,
  effectiveKeys: new Set(TENANT_KEYS),
};
const regionManager = (includeDescendants: boolean): GrantingActor => ({
  accountId: id<'Account'>(202),
  population: 'tenant-staff',
  roleId: SITE_EDITOR,
  roleScope: 'site',
  holdsSystemRole: false,
  scope: site(REGION, includeDescendants),
  effectiveKeys: new Set(['content.page.edit', 'content.page.publish']),
});

const role = (over: Partial<GrantedRole> & Pick<GrantedRole, 'id' | 'scope'>): GrantedRole => ({
  kind: 'default',
  effectiveKeys: new Set(),
  ...over,
});
const staff = { accountId: id<'Account'>(301), population: 'tenant-staff' } as const;
const portalUser = { accountId: id<'Account'>(401), population: 'portal-user' } as const;
const otherOperator = { accountId: id<'Account'>(102), population: 'platform-operator' } as const;

const siteEditor = role({
  id: SITE_EDITOR,
  scope: 'site',
  effectiveKeys: new Set(['content.page.edit']),
});
const at = (scope: GrantScope, siteRelation?: SiteRelation): GrantPlacement =>
  siteRelation === undefined ? { scope } : { scope, siteRelation };

describe('GrantPolicy.canGrant', () => {
  it('lets the tenant system role grant a role with any key it holds, protected included', () => {
    const editor = role({
      id: EDITOR,
      scope: 'tenant',
      effectiveKeys: new Set(['identity.member.invite', 'content.page.edit']),
    });

    expect(GrantPolicy.canGrant(tenantOwner, editor, staff, at(TENANT), catalogue)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('lets the operator system role grant a platform role to another operator', () => {
    const viewer = role({ id: id(9), scope: 'platform', effectiveKeys: new Set(PLATFORM_KEYS) });

    expect(GrantPolicy.canGrant(operator, viewer, otherOperator, at(PLATFORM), catalogue).ok).toBe(
      true,
    );
  });

  describe('population (ADR-0019 decision 2): a portal user never holds a staff role', () => {
    it.each<[string, GrantedRole, GrantPlacement]>([
      ['a tenant role', role({ id: EDITOR, scope: 'tenant' }), at(TENANT)],
      ['a site role', siteEditor, at(site(HQ))],
      [
        'the tenant system role',
        role({ id: TENANT_SYSTEM, scope: 'tenant', kind: 'system' }),
        at(TENANT),
      ],
    ])(
      'refuses %s to a portal user, even from the tenant system role',
      (_case, granted, placement) => {
        expect(
          GrantPolicy.canGrant(tenantOwner, granted, portalUser, placement, catalogue),
        ).toEqual({
          ok: false,
          error: { code: 'role.not-grantable', reason: 'population' },
        });
      },
    );

    it('refuses a platform role to tenant staff, and a staff role to an operator', () => {
      const platformRole = role({ id: id(9), scope: 'platform' });
      expect(GrantPolicy.canGrant(operator, platformRole, staff, at(PLATFORM), catalogue)).toEqual({
        ok: false,
        error: { code: 'role.not-grantable', reason: 'population' },
      });
      expect(
        GrantPolicy.canGrant(
          tenantOwner,
          role({ id: EDITOR, scope: 'tenant' }),
          otherOperator,
          at(TENANT),
          catalogue,
        ),
      ).toMatchObject({ ok: false, error: { reason: 'population' } });
    });
  });

  it('refuses a grant placed at another level than its role', () => {
    expect(GrantPolicy.canGrant(tenantOwner, siteEditor, staff, at(TENANT), catalogue)).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'placement' },
    });
  });

  it('refuses an operator granting a staff role: operators grant platform roles only', () => {
    const operatorWithKeys = { ...operator, effectiveKeys: new Set(TENANT_KEYS) };
    expect(
      GrantPolicy.canGrant(operatorWithKeys, siteEditor, staff, at(site(HQ)), catalogue),
    ).toMatchObject({ ok: false, error: { reason: 'scope' } });
  });

  describe('subtree (ADR-0018 decision 6): a site grantor stays within its own reach', () => {
    it('lets a tenant grantor place a site role on any site', () => {
      expect(
        GrantPolicy.canGrant(tenantOwner, siteEditor, staff, at(site(BRANCH, true)), catalogue).ok,
      ).toBe(true);
    });

    it('lets a site grantor grant on its own site', () => {
      expect(
        GrantPolicy.canGrant(regionManager(false), siteEditor, staff, at(site(REGION)), catalogue)
          .ok,
      ).toBe(true);
    });

    it('lets a subtree grantor grant on a descendant, and hand out its own subtree', () => {
      const manager = regionManager(true);
      expect(
        GrantPolicy.canGrant(manager, siteEditor, staff, at(site(BRANCH), 'descendant'), catalogue)
          .ok,
      ).toBe(true);
      expect(
        GrantPolicy.canGrant(manager, siteEditor, staff, at(site(REGION, true)), catalogue).ok,
      ).toBe(true);
    });

    it.each<[string, GrantingActor, GrantPlacement]>([
      [
        'a descendant, without includeDescendants',
        regionManager(false),
        at(site(BRANCH), 'descendant'),
      ],
      ['its own subtree, without includeDescendants', regionManager(false), at(site(REGION, true))],
      ['the parent (access never flows up)', regionManager(true), at(site(HQ), 'outside')],
      [
        'a sibling (access never flows sideways)',
        regionManager(true),
        at(site(OTHER_REGION), 'outside'),
      ],
      [
        'another site whose relation is unknown (fail closed)',
        regionManager(true),
        at(site(BRANCH)),
      ],
    ])('refuses %s', (_case, actor, placement) => {
      expect(GrantPolicy.canGrant(actor, siteEditor, staff, placement, catalogue)).toEqual({
        ok: false,
        error: { code: 'role.not-grantable', reason: 'subtree' },
      });
    });

    it('refuses a site grantor a tenant-wide grant', () => {
      const tenantEditor = role({ id: EDITOR, scope: 'tenant' });
      expect(
        GrantPolicy.canGrant(regionManager(true), tenantEditor, staff, at(TENANT), catalogue),
      ).toMatchObject({ ok: false, error: { reason: 'subtree' } });
    });
  });

  it('refuses a role conferring a key the actor does not hold (R1)', () => {
    const publisher = role({
      id: EDITOR,
      scope: 'site',
      effectiveKeys: new Set(['content.page.edit', 'identity.member.view']),
    });
    expect(
      GrantPolicy.canGrant(regionManager(false), publisher, staff, at(site(REGION)), catalogue),
    ).toEqual({ ok: false, error: { code: 'role.not-grantable', reason: 'keys-not-held' } });
  });

  it('refuses a system role to an actor who does not hold that same role (R3)', () => {
    const tenantSystem = role({ id: TENANT_SYSTEM, scope: 'tenant', kind: 'system' });
    const editorActor: GrantingActor = {
      ...tenantOwner,
      roleId: EDITOR,
      holdsSystemRole: false,
    };
    expect(GrantPolicy.canGrant(editorActor, tenantSystem, staff, at(TENANT), catalogue)).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'system-role' },
    });
    expect(GrantPolicy.canGrant(tenantOwner, tenantSystem, staff, at(TENANT), catalogue).ok).toBe(
      true,
    );
  });

  it('refuses a protected key unless the actor holds the system role of its scope (R11)', () => {
    const inviter = role({
      id: EDITOR,
      scope: 'tenant',
      effectiveKeys: new Set(['identity.member.invite']),
    });
    const holderWithoutSystemRole: GrantingActor = {
      ...tenantOwner,
      roleId: EDITOR,
      holdsSystemRole: false,
    };
    expect(
      GrantPolicy.canGrant(holderWithoutSystemRole, inviter, staff, at(TENANT), catalogue),
    ).toEqual({ ok: false, error: { code: 'role.not-grantable', reason: 'protected-key' } });
  });
});

describe('GrantPolicy.canActOn', () => {
  const target = (
    population: ActedOnAccount['population'],
    keys: readonly string[],
    n = 900,
  ): ActedOnAccount => ({ accountId: id(n), population, effectiveKeys: new Set(keys) });

  it('never lets an actor act on itself', () => {
    expect(
      GrantPolicy.canActOn(tenantOwner, {
        ...target('tenant-staff', []),
        accountId: tenantOwner.accountId,
      }),
    ).toEqual({ ok: false, error: { code: 'member.self' } });
  });

  it('within one population, allows only a target whose keys the actor holds', () => {
    expect(
      GrantPolicy.canActOn(tenantOwner, target('tenant-staff', ['content.page.edit'])).ok,
    ).toBe(true);
    expect(GrantPolicy.canActOn(regionManager(true), target('tenant-staff', TENANT_KEYS))).toEqual({
      ok: false,
      error: { code: 'member.outranks-actor' },
    });
  });

  it('lets staff act on a portal user and an operator act on staff and portal users', () => {
    expect(GrantPolicy.canActOn(regionManager(false), target('portal-user', [])).ok).toBe(true);
    expect(GrantPolicy.canActOn(operator, target('tenant-staff', TENANT_KEYS)).ok).toBe(true);
    expect(GrantPolicy.canActOn(operator, target('portal-user', [])).ok).toBe(true);
  });

  it('never lets staff act on an operator, nor a portal user act on anyone', () => {
    expect(GrantPolicy.canActOn(tenantOwner, target('platform-operator', []))).toEqual({
      ok: false,
      error: { code: 'member.outranks-actor' },
    });
    const portalActor: GrantingActor = {
      ...tenantOwner,
      population: 'portal-user',
      effectiveKeys: new Set(),
    };
    expect(GrantPolicy.canActOn(portalActor, target('portal-user', []))).toEqual({
      ok: false,
      error: { code: 'member.outranks-actor' },
    });
  });
});
