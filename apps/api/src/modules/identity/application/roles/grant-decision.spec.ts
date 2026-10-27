import type { Id } from '@phoenix/shared-kernel';
import type { GrantedRole, GrantScope, SiteRelation } from '../../../../platform/authz';
import { TEST_TENANTS } from '../../../../../test/support/test-config';
import { effectiveKeysOf, grantingActorsOf } from './acting-assignments';
import { decideGrant } from './grant-decision';
import type { AssignmentRecord, RoleRecord } from './role.repository';
import {
  testCatalogue,
  testGrant,
  testId,
  testRole,
} from '../../../../../test/support/role-catalogue';

const MANAGE = 'identity.role-assignments.manage';
const actorId = testId<'Account'>();
const targetId = testId<'Account'>();

const granted = (role: RoleRecord): GrantedRole => ({
  id: role.id,
  scope: role.scope,
  kind: role.kind,
  effectiveKeys: effectiveKeysOf(role, testCatalogue),
});
const target = (keys: string[] = [], accountId = targetId) => ({
  accountId,
  population: 'tenant-staff' as const,
  effectiveKeys: new Set(keys),
});
const actorsOf = (grants: AssignmentRecord[]) =>
  grantingActorsOf(actorId, 'tenant-staff', grants, MANAGE, testCatalogue);
const none = new Map<Id<'Site'>, SiteRelation>();

describe.each(TEST_TENANTS)('decideGrant (tenant %s)', () => {
  const editor = testRole({ scope: 'site', permissionKeys: ['content.items.edit'] });
  const parent = testId<'Site'>();
  const child = testId<'Site'>();
  const onSite = (siteId: Id<'Site'>, includeDescendants = false): GrantScope => ({
    level: 'site',
    siteId,
    includeDescendants,
  });

  it('lets a system role holder grant a role anywhere in the tenant', () => {
    const actors = actorsOf([testGrant(testRole({ kind: 'system' }))]);
    const decided = decideGrant(
      actors,
      granted(editor),
      target(),
      onSite(child),
      none,
      testCatalogue,
    );
    expect(decided.ok && decided.value.holdsSystemRole).toBe(true);
  });

  it('lets a site admin grant within its subtree only, and only downward', () => {
    const siteAdmin = testRole({
      scope: 'site',
      permissionKeys: [MANAGE, 'content.items.edit'],
    });
    const actors = actorsOf([
      testGrant(siteAdmin, { level: 'site', siteId: parent, includeDescendants: true }),
    ]);
    const below = new Map([[parent, 'descendant' as const]]);
    const outside = new Map([[parent, 'outside' as const]]);

    expect(
      decideGrant(actors, granted(editor), target(), onSite(child), below, testCatalogue).ok,
    ).toBe(true);
    expect(
      decideGrant(actors, granted(editor), target(), onSite(parent, true), none, testCatalogue).ok,
    ).toBe(true);
    expect(
      decideGrant(actors, granted(editor), target(), onSite(child), outside, testCatalogue),
    ).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'subtree' },
    });
    // A missing relation counts as outside (fail closed).
    expect(
      decideGrant(actors, granted(editor), target(), onSite(child), none, testCatalogue).ok,
    ).toBe(false);
    // A tenant role is beyond any site grant's reach.
    const tenantRole = testRole({ permissionKeys: ['content.items.edit'] });
    expect(
      decideGrant(actors, granted(tenantRole), target(), { level: 'tenant' }, none, testCatalogue),
    ).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'subtree' },
    });
  });

  it('refuses a thisSite grantor handing out includeDescendants on its own site', () => {
    const siteAdmin = testRole({ scope: 'site', permissionKeys: [MANAGE, 'content.items.edit'] });
    const actors = actorsOf([testGrant(siteAdmin, { level: 'site', siteId: parent })]);
    expect(
      decideGrant(actors, granted(editor), target(), onSite(parent), none, testCatalogue).ok,
    ).toBe(true);
    expect(
      decideGrant(actors, granted(editor), target(), onSite(parent, true), none, testCatalogue),
    ).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'subtree' },
    });
  });

  it('refuses keys the actor lacks, the system role to a non-holder, and itself', () => {
    const delegate = testRole({ permissionKeys: [MANAGE] });
    const actors = actorsOf([testGrant(delegate)]);
    expect(
      decideGrant(actors, granted(editor), target(), onSite(child), none, testCatalogue),
    ).toEqual({
      ok: false,
      error: { code: 'role.not-grantable', reason: 'keys-not-held' },
    });
    const system = testRole({ kind: 'system' });
    expect(
      decideGrant(actors, granted(system), target(), { level: 'tenant' }, none, testCatalogue).ok,
    ).toBe(false);
    const holder = actorsOf([testGrant(system)]);
    expect(
      decideGrant(holder, granted(editor), target([], actorId), onSite(child), none, testCatalogue),
    ).toEqual({ ok: false, error: { code: 'member.self' } });
  });

  it('refuses to act on an account that holds keys the actor does not', () => {
    const delegate = testRole({ permissionKeys: [MANAGE, 'content.items.edit'] });
    const actors = actorsOf([testGrant(delegate)]);
    expect(
      decideGrant(
        actors,
        granted(editor),
        target(['identity.accounts.manage']),
        onSite(child),
        none,
        testCatalogue,
      ),
    ).toEqual({ ok: false, error: { code: 'member.outranks-actor' } });
  });

  it('refuses when the actor has no grant to act under', () => {
    expect(decideGrant([], granted(editor), target(), onSite(child), none, testCatalogue).ok).toBe(
      false,
    );
  });
});
