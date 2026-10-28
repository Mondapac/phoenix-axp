import { randomUUID } from 'node:crypto';
import { encodeAuditFields, ok, Temporal } from '@phoenix/shared-kernel';
import type {
  AuditEntry,
  AuthenticatedActor,
  CallContext,
  Id,
  Result,
  TenantContext,
} from '@phoenix/shared-kernel';
import { FixedClock, SequenceIdGenerator, testCallContext } from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { AuditWriter } from '../../src/platform/audit/audit-writer';
import { declarePermissions, definePermission } from '../../src/platform/authz/permission';
import { PermissionRegistry } from '../../src/platform/authz/permission-registry';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import {
  StaleAggregateError,
  TransactionConflictError,
} from '../../src/platform/unit-of-work/errors';
import { IdentityAuthorisationCheck } from '../../src/modules/identity/application/access/identity-authorisation-check';
import { SessionAuthenticator } from '../../src/modules/identity/application/access/session-authenticator';
import { DirectorySyncRunner } from '../../src/modules/identity/application/directory-sync-runner';
import { SignInFlows } from '../../src/modules/identity/application/sign-in-flow';
import type { StaffDirectory } from '../../src/modules/identity/application/staff-directory';
import type {
  ProviderFailure,
  ProviderIdentity,
  StaffIdentityProvider,
} from '../../src/modules/identity/application/staff-identity-provider';
import { BeginStaffSignIn } from '../../src/modules/identity/application/use-cases/begin-staff-sign-in.use-case';
import { CompleteStaffSignIn } from '../../src/modules/identity/application/use-cases/complete-staff-sign-in.use-case';
import { CreateLocalStaffAccount } from '../../src/modules/identity/application/use-cases/create-local-staff-account.use-case';
import { DisableStaffAccount } from '../../src/modules/identity/application/use-cases/disable-staff-account.use-case';
import { ListStaffAccounts } from '../../src/modules/identity/application/use-cases/list-staff-accounts.use-case';
import { RunDirectorySyncNow } from '../../src/modules/identity/application/use-cases/run-directory-sync-now.use-case';
import { SignOut } from '../../src/modules/identity/application/use-cases/sign-out.use-case';
import { SyncDirectoryAccounts } from '../../src/modules/identity/application/use-cases/sync-directory-accounts.use-case';
import { UpdateDirectorySyncInterval } from '../../src/modules/identity/application/use-cases/update-directory-sync-interval.use-case';
import { ViewDirectorySync } from '../../src/modules/identity/application/use-cases/view-directory-sync.use-case';
import { ViewOwnAccount } from '../../src/modules/identity/application/use-cases/view-own-account.use-case';
import { ViewOwnPermissions } from '../../src/modules/identity/application/use-cases/view-own-permissions.use-case';
import { IdentityActorGrantReader } from '../../src/modules/identity/application/access/identity-actor-grant-reader';
import { AssignRole } from '../../src/modules/identity/application/use-cases/assign-role.use-case';
import { BootstrapTenantAdministrator } from '../../src/modules/identity/application/use-cases/bootstrap-tenant-administrator.use-case';
import { ChangeRoleDefinitionScope } from '../../src/modules/identity/application/use-cases/change-role-definition-scope.use-case';
import { ChangeRoleFieldRules } from '../../src/modules/identity/application/use-cases/change-role-field-rules.use-case';
import { ChangeRolePermissions } from '../../src/modules/identity/application/use-cases/change-role-permissions.use-case';
import { ViewRoleFieldRules } from '../../src/modules/identity/application/use-cases/view-role-field-rules.use-case';
import { IdentityFieldRuleReader } from '../../src/modules/identity/application/access/identity-field-rule-reader';
import { IdentityRoleHoldingReader } from '../../src/modules/identity/application/access/identity-role-holding-reader';
import {
  resolveFieldAccess,
  type FieldDescriptor,
  type FieldRequest,
} from '../../src/platform/authz/field-policy';
import { CreateRole } from '../../src/modules/identity/application/use-cases/create-role.use-case';
import { ListAccountRoleAssignments } from '../../src/modules/identity/application/use-cases/list-account-role-assignments.use-case';
import { ListPermissions } from '../../src/modules/identity/application/use-cases/list-permissions.use-case';
import { ListRoles } from '../../src/modules/identity/application/use-cases/list-roles.use-case';
import { RevokeRoleAssignment } from '../../src/modules/identity/application/use-cases/revoke-role-assignment.use-case';
import { IDENTITY_PERMISSIONS } from '../../src/modules/identity/contracts/permissions';
import { PrismaRoleRepository } from '../../src/modules/identity/infrastructure/prisma-role.repository';
import { ClosureSiteAncestryReader } from '../../src/modules/tenancy/infrastructure/site-ancestry.reader';
import { PrismaSiteRepository } from '../../src/modules/tenancy/infrastructure/prisma-site.repository';
import { IDENTITY_AUDIT_ACTIONS } from '../../src/modules/identity/domain/audit-actions';
import type { DirectoryStatus } from '../../src/modules/identity/domain/directory-sync';
import { PrismaAccountRepository } from '../../src/modules/identity/infrastructure/prisma-account.repository';
import { PrismaDirectorySyncRepository } from '../../src/modules/identity/infrastructure/prisma-directory-sync.repository';
import { PrismaSessionRepository } from '../../src/modules/identity/infrastructure/prisma-session.repository';
import { TEST_TENANT_CONFIG_DIRS, TEST_TENANTS, testTenantId } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { testDatabaseUrl } from './test-database';

// Phase 1 slice 1.5: identity end to end against PostgreSQL, through the real repositories,
// UnitOfWork, tenant guard and row-level security, with the real authenticator and
// authorisation check behind the gate. Keycloak is a scripted provider: the OIDC adapter has
// its own tests (keycloak-oidc.spec.ts).

const DEFINITIONS = new Map(IDENTITY_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(context: CallContext, entry: AuditEntry): Promise<void> {
    const definition = DEFINITIONS.get(entry.action);
    if (definition === undefined) throw new Error(`undeclared audit action ${entry.action}`);
    expect(definition.actors).toContain(context.actor.kind);
    const registry = permissionRegistry();
    const options = { isKnownPermissionKey: (key: string) => registry.isKnownPermissionKey(key) };
    for (const [fields, values] of [
      [definition.before, entry.before],
      [definition.after, entry.after],
    ] as const) {
      if (fields === null) expect(values ?? null).toBeNull();
      else expect(encodeAuditFields(fields, values, options).ok).toBe(true);
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((entry) => entry.action);
  }
}

/** Answers the next identity it is given, as Keycloak would after a sign-in. */
class ScriptedProvider implements StaffIdentityProvider {
  next: Result<ProviderIdentity, ProviderFailure> = { ok: false, error: 'provider.rejected' };
  authorizationUrl(): string {
    return 'https://sso.example.test/auth';
  }
  exchange(): Promise<Result<ProviderIdentity, ProviderFailure>> {
    return Promise.resolve(this.next);
  }
}

/** The tenant's directory: every subject enabled unless set otherwise; `down` answers nothing. */
class ScriptedDirectory implements StaffDirectory {
  readonly statuses = new Map<string, DirectoryStatus>();
  down = false;
  /** When set, the answer for every subject. */
  everyone: DirectoryStatus | null = null;
  statusOf(_tenant: TenantContext, subjects: readonly string[]) {
    if (this.down)
      return Promise.resolve({ ok: false as const, error: 'directory.unavailable' as const });
    return Promise.resolve(
      ok(
        new Map(
          subjects.map((subject) => [
            subject,
            this.everyone ?? this.statuses.get(subject) ?? 'enabled',
          ]),
        ),
      ),
    );
  }
}

const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

/** A site key of another module, so a site role can confer an unprotected key. */
const CONTENT_ITEMS_EDIT = definePermission('content', {
  key: 'content.items.edit',
  scope: 'site',
  protected: false,
});

/** Keys over run-time definitions (ADR-0024 decision 2), as the objects module will declare. */
const RECORDS_READ = definePermission('records', {
  key: 'records.item.read',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});
const RECORDS_UPDATE = definePermission('records', {
  key: 'records.item.update',
  scope: 'site',
  protected: false,
  qualifier: 'definition',
});

/** The sealed registry of the running app, with the identity catalogue and the test keys. */
function permissionRegistry(): PermissionRegistry {
  const registry = new PermissionRegistry();
  registry.register('identity', IDENTITY_PERMISSIONS);
  registry.register('content', declarePermissions('content', [CONTENT_ITEMS_EDIT]));
  registry.register('records', declarePermissions('records', [RECORDS_READ, RECORDS_UPDATE]));
  registry.seal();
  return registry;
}

describe.each(TEST_TENANTS)('the identity module in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-27T12:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  const provider = new ScriptedProvider();
  const directory = new ScriptedDirectory();
  const flows = new SignInFlows(Buffer.alloc(32, 9));
  let persistence: Persistence;
  /** The application login, writing roles and grants under the tenant's own policy. */
  let writer: Client;
  let identity: ReturnType<typeof build>;

  function build(p: Persistence) {
    const permissions = permissionRegistry();
    const tenants = new TenantRegistry(
      loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANTS.map(testTenantId)),
    );
    const uow = p.unitOfWork;
    const accounts = new PrismaAccountRepository(p.service);
    const sessions = new PrismaSessionRepository(p.service);
    const check = new IdentityAuthorisationCheck(uow, sessions, permissions, clock);
    const gate = createUseCaseGate(tenants, permissions, check);
    const syncs = new PrismaDirectorySyncRepository(p.service);
    const runner = new DirectorySyncRunner(uow, syncs, accounts, sessions, directory, audit, clock);
    const roles = new PrismaRoleRepository(p.service);
    const sites = new PrismaSiteRepository(p.service);
    const ancestry = new ClosureSiteAncestryReader(uow, sites);
    return {
      sites,
      listRoles: new ListRoles(gate, uow, roles),
      listPermissions: new ListPermissions(gate, permissions),
      createRole: new CreateRole(gate, uow, roles, permissions, audit, clock, ids),
      changeRole: new ChangeRolePermissions(gate, uow, roles, permissions, audit, clock),
      changeScope: new ChangeRoleDefinitionScope(gate, uow, roles, permissions, audit, clock),
      changeFieldRules: new ChangeRoleFieldRules(gate, uow, roles, permissions, audit, clock),
      viewFieldRules: new ViewRoleFieldRules(gate, uow, roles),
      fieldRules: new IdentityFieldRuleReader(uow, sessions, roles, permissions, clock),
      roleHoldings: new IdentityRoleHoldingReader(
        uow,
        accounts,
        sessions,
        roles,
        permissions,
        clock,
      ),
      ancestry,
      listGrants: new ListAccountRoleAssignments(gate, uow, accounts, roles),
      assign: new AssignRole(gate, uow, accounts, roles, permissions, ancestry, audit, clock, ids),
      revoke: new RevokeRoleAssignment(gate, uow, accounts, roles, permissions, ancestry, audit),
      bootstrap: new BootstrapTenantAdministrator(gate, uow, accounts, roles, audit, clock, ids),
      sync: new SyncDirectoryAccounts(gate, runner),
      syncNow: new RunDirectorySyncNow(gate, runner),
      viewSync: new ViewDirectorySync(gate, uow, syncs),
      setInterval: new UpdateDirectorySyncInterval(gate, uow, syncs, audit, clock),
      authenticator: new SessionAuthenticator(uow, sessions, clock),
      begin: new BeginStaffSignIn(gate, flows, provider),
      complete: new CompleteStaffSignIn(
        gate,
        uow,
        flows,
        provider,
        accounts,
        sessions,
        audit,
        clock,
        ids,
        8,
      ),
      signOut: new SignOut(gate, uow, sessions, audit),
      viewOwn: new ViewOwnAccount(gate, uow, accounts),
      viewOwnPermissions: new ViewOwnPermissions(
        gate,
        new IdentityActorGrantReader(uow, sessions, roles, permissions, clock),
      ),
      list: new ListStaffAccounts(gate, uow, accounts),
      create: new CreateLocalStaffAccount(gate, uow, accounts, audit, clock, ids),
      disable: new DisableStaffAccount(
        gate,
        uow,
        accounts,
        sessions,
        roles,
        permissions,
        audit,
        clock,
      ),
    };
  }

  beforeAll(async () => {
    persistence = createPersistence();
    writer = new Client({ connectionString: testDatabaseUrl() });
    await writer.connect();
    identity = build(persistence);
  });

  afterAll(async () => {
    await writer.end();
    await persistence.close();
  });

  /** One statement as the application login in `of`'s tenant, committed. */
  async function sql(of: TenantContext, text: string, params: unknown[]): Promise<void> {
    await writer.query('BEGIN');
    try {
      await writer.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [of.tenantId]);
      await writer.query(text, params);
      await writer.query('COMMIT');
    } catch (error) {
      await writer.query('ROLLBACK');
      throw error;
    }
  }

  async function role(kind: 'system' | 'custom', scope: 'tenant' | 'site', keys: string[]) {
    const id = ids.next();
    await sql(
      tenant,
      `INSERT INTO identity.role (id, tenant_id, key, kind, scope, permission_keys, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, now(), now())`,
      [id, tenant.tenantId, unique('role'), kind, scope, keys],
    );
    return id;
  }

  async function grant(accountId: string, roleId: string, siteId: string | null = null) {
    const id = ids.next();
    await sql(
      tenant,
      `INSERT INTO identity.role_assignment (id, tenant_id, account_id, role_id, level, site_id, include_descendants, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, now())`,
      [id, tenant.tenantId, accountId, roleId, siteId === null ? 'tenant' : 'site', siteId],
    );
    return id;
  }

  /** Signs `who` in through the scripted provider: the session token and the account id. */
  async function signIn(who: { username: string; directory: boolean; subject?: string }) {
    const anonymous = testCallContext(tenant, 'anonymous');
    const began = await identity.begin.execute(anonymous, undefined);
    if (!began.ok) throw new Error('begin failed');
    const flow = flows.derive(began.value.flowSecret, tenant)!;
    provider.next = ok({
      subject: who.subject ?? `sub-${who.username}`,
      username: who.username,
      directory: who.directory,
      idpSessionId: 'sid-1',
    });
    return identity.complete.execute(anonymous, {
      code: 'code-1',
      state: flow.state,
      flowSecret: began.value.flowSecret,
    });
  }

  async function signedIn(who: { username: string; directory: boolean; subject?: string }) {
    const result = await signIn(who);
    if (!result.ok) throw new Error(`sign-in failed: ${result.error.code}`);
    return result.value;
  }

  async function contextOf(token: string, of: TenantContext = tenant): Promise<CallContext> {
    const actor = await identity.authenticator.authenticate(of, token);
    if (!actor.ok) throw new Error('not authenticated');
    return testCallContext(of, actor.value);
  }

  it('provisions a directory user on first sign-in, with no roles, and starts a session', async () => {
    const username = unique('dir');
    const session = await signedIn({ username, directory: true });

    const actor = await identity.authenticator.authenticate(tenant, session.sessionToken);
    expect(actor.ok && actor.value).toMatchObject({
      kind: 'authenticated',
      tenantId: tenant.tenantId,
      population: 'tenant-staff',
      accountId: session.accountId,
    } satisfies Partial<AuthenticatedActor>);
    const context = await contextOf(session.sessionToken);
    expect(await identity.viewOwn.execute(context, undefined)).toEqual({
      ok: true,
      value: {
        accountId: session.accountId,
        population: 'tenant-staff',
        source: 'directory',
        username,
      },
    });
    // No roles: no permission.
    expect(await identity.list.execute(context, undefined)).toEqual({
      ok: false,
      error: { code: 'access.denied' },
    });
    expect(audit.actions()).toEqual(
      expect.arrayContaining(['identity.account.provisioned', 'identity.session.started']),
    );
    // A second sign-in reuses the account.
    expect((await signedIn({ username, directory: true })).accountId).toBe(session.accountId);
  });

  it('stores only the SHA-256 of the session token', async () => {
    const session = await signedIn({ username: unique('dir'), directory: true });
    await writer.query('BEGIN');
    try {
      await writer.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
        tenant.tenantId,
      ]);
      const { rows } = await writer.query<{ token_hash: Buffer; idp_session_id: string }>(
        'SELECT token_hash, idp_session_id FROM identity.session WHERE account_id = $1',
        [session.accountId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).toHaveLength(32);
      expect(rows[0]!.token_hash.toString('utf8')).not.toContain(session.sessionToken);
      expect(rows[0]!.idp_session_id).toBe('sid-1');
    } finally {
      await writer.query('ROLLBACK');
    }
  });

  it('refuses a session cookie presented with another tenant (security review S2-3)', async () => {
    const session = await signedIn({ username: unique('dir'), directory: true });
    expect(await identity.authenticator.authenticate(other, session.sessionToken)).toEqual({
      ok: false,
      error: { code: 'credential.rejected' },
    });
    expect((await identity.authenticator.authenticate(tenant, 'x'.repeat(43))).ok).toBe(false);
    expect((await identity.authenticator.authenticate(tenant, 'short')).ok).toBe(false);
  });

  it('refuses an expired session, and a flow whose state does not match', async () => {
    const session = await signedIn({ username: unique('dir'), directory: true });
    clock.advance(Temporal.Duration.from({ hours: 9 }));
    try {
      expect((await identity.authenticator.authenticate(tenant, session.sessionToken)).ok).toBe(
        false,
      );
    } finally {
      clock.advance(Temporal.Duration.from({ hours: -9 }));
    }

    const anonymous = testCallContext(tenant, 'anonymous');
    const began = await identity.begin.execute(anonymous, undefined);
    if (!began.ok) throw new Error('begin failed');
    expect(
      await identity.complete.execute(anonymous, {
        code: 'c',
        state: 'forged',
        flowSecret: began.value.flowSecret,
      }),
    ).toEqual({ ok: false, error: { code: 'sign-in.flow-invalid' } });
    // The flow of one tenant does not complete in the other.
    const flow = flows.derive(began.value.flowSecret, tenant)!;
    expect(
      await identity.complete.execute(testCallContext(other, 'anonymous'), {
        code: 'c',
        state: flow.state,
        flowSecret: began.value.flowSecret,
      }),
    ).toEqual({ ok: false, error: { code: 'sign-in.flow-invalid' } });
  });

  it('maps provider failures and refuses an unknown local user', async () => {
    const anonymous = testCallContext(tenant, 'anonymous');
    const began = await identity.begin.execute(anonymous, undefined);
    if (!began.ok) throw new Error('begin failed');
    const flow = flows.derive(began.value.flowSecret, tenant)!;
    const input = { code: 'c', state: flow.state, flowSecret: began.value.flowSecret };
    provider.next = { ok: false, error: 'provider.unavailable' };
    expect(await identity.complete.execute(anonymous, input)).toEqual({
      ok: false,
      error: { code: 'sign-in.unavailable' },
    });
    provider.next = { ok: false, error: 'provider.rejected' };
    expect(await identity.complete.execute(anonymous, input)).toEqual({
      ok: false,
      error: { code: 'sign-in.rejected' },
    });
    expect(await signIn({ username: unique('stranger'), directory: false })).toEqual({
      ok: false,
      error: { code: 'sign-in.no-staff-account' },
    });
  });

  describe("the tenant's first administrator (owner card of slice 1.6)", () => {
    const system = testCallContext(tenant, 'system');

    it('creates the local account, then grants the system role once it has signed in', async () => {
      const username = unique('founder');
      const first = await identity.bootstrap.execute(system, { username: ` ${username} ` });
      if (!first.ok || first.value.outcome !== 'sign-in-needed') throw new Error('not created');
      expect(first.value.created).toBe(true);
      expect(audit.entries.at(-1)).toMatchObject({
        action: 'identity.account.created',
        targetId: first.value.accountId,
      });
      // Not linked yet: no grant, whatever the number of runs.
      expect(await identity.bootstrap.execute(system, { username })).toEqual({
        ok: true,
        value: { outcome: 'sign-in-needed', accountId: first.value.accountId, created: false },
      });

      const session = await signedIn({ username, directory: false });
      expect(session.accountId).toBe(first.value.accountId);
      // Linked: the operator confirms the account with the person, then names it (review M1).
      const accountId = first.value.accountId;
      expect(await identity.bootstrap.execute(system, { username })).toEqual({
        ok: true,
        value: { outcome: 'confirm-needed', accountId },
      });
      expect(
        await identity.bootstrap.execute(system, { username, accountId: ids.next<'Account'>() }),
      ).toEqual({ ok: false, error: { code: 'identity.account.not-found' } });
      expect(
        await identity.bootstrap.execute(system, { username: unique('nobody'), accountId }),
      ).toEqual({ ok: false, error: { code: 'identity.account.not-found' } });
      const before = audit.entries.length;
      expect(await identity.bootstrap.execute(system, { username, accountId })).toEqual({
        ok: true,
        value: { outcome: 'granted', accountId },
      });
      expect(audit.entries.slice(before).map((e) => e.action)).toEqual([
        'identity.role.system-seeded',
        'identity.role.founding-assigned',
      ]);

      // The founder now holds every key of the tenant.
      const founder = await contextOf(session.sessionToken);
      expect((await identity.list.execute(founder, undefined)).ok).toBe(true);
      const roles = await identity.listRoles.execute(founder, undefined);
      expect(roles.ok && roles.value.filter((r) => r.kind === 'system')).toEqual([
        expect.objectContaining({ key: 'tenant-administrator', scope: 'tenant' }),
      ]);
      // A custom role cannot take the seed key.
      expect(
        await identity.createRole.execute(founder, {
          key: 'Tenant-Administrator',
          scope: 'tenant',
          permissionKeys: ['identity.accounts.view'],
        }),
      ).toEqual({ ok: false, error: { code: 'identity.role.key-taken' } });

      // From here on, grants go through studio.
      expect(await identity.bootstrap.execute(system, { username: unique('second') })).toEqual({
        ok: false,
        error: { code: 'identity.tenant.has-administrator' },
      });

      // Every holder disabled (here, by hand): the command recovers the tenant, reusing the role.
      await sql(tenant, 'UPDATE identity.account SET status = $2 WHERE id = $1', [
        first.value.accountId,
        'disabled',
      ]);
      expect(await identity.bootstrap.execute(system, { username, accountId })).toEqual({
        ok: false,
        error: { code: 'identity.account.disabled' },
      });
      const successor = unique('successor');
      await identity.bootstrap.execute(system, { username: successor });
      const linked = await signedIn({ username: successor, directory: false });
      const recovered = audit.entries.length;
      expect(
        await identity.bootstrap.execute(system, {
          username: successor,
          accountId: linked.accountId,
        }),
      ).toMatchObject({ ok: true, value: { outcome: 'granted' } });
      expect(audit.entries.slice(recovered).map((e) => e.action)).toEqual([
        'identity.role.founding-assigned',
      ]);
    });

    it('grants once when two runs for two accounts race (review L4)', async () => {
      // The tenant has an administrator by now: disable every holder, so it has none again.
      await sql(
        tenant,
        `UPDATE identity.account SET status = 'disabled'
          WHERE id IN (SELECT account_id FROM identity.role_assignment WHERE level = 'tenant')`,
        [],
      );
      const linked = [];
      for (const name of [unique('race-a'), unique('race-b')]) {
        await identity.bootstrap.execute(system, { username: name });
        const session = await signedIn({ username: name, directory: false });
        linked.push({ username: name, accountId: session.accountId });
      }
      const results = await Promise.allSettled(
        linked.map((input) => identity.bootstrap.execute(system, input)),
      );
      // The loser is refused, or, under load, runs out of serializable retries (a conflict):
      // never two founders.
      expect(results.filter((r) => r.status === 'fulfilled' && r.value.ok)).toHaveLength(1);
      expect(
        results.filter(
          (r) =>
            (r.status === 'fulfilled' &&
              !r.value.ok &&
              r.value.error.code === 'identity.tenant.has-administrator') ||
            (r.status === 'rejected' && r.reason instanceof TransactionConflictError),
        ),
      ).toHaveLength(1);
    });

    it('refuses an invalid username, and any actor but the system', async () => {
      expect(await identity.bootstrap.execute(system, { username: 'bad name' })).toEqual({
        ok: false,
        error: { code: 'identity.value.invalid', field: 'username' },
      });
      const session = await signedIn({ username: unique('dir'), directory: true });
      expect(
        await identity.bootstrap.execute(await contextOf(session.sessionToken), {
          username: unique('x'),
        }),
      ).toEqual({ ok: false, error: { code: 'access.denied' } });
      expect(
        await identity.bootstrap.execute(testCallContext(tenant, 'anonymous'), {
          username: unique('x'),
        }),
      ).toMatchObject({ ok: false });
    });
  });

  describe('with a tenant administrator', () => {
    let admin: CallContext;
    let adminAccount: Id<'Account'>;

    beforeAll(async () => {
      const session = await signedIn({ username: unique('admin'), directory: true });
      adminAccount = session.accountId;
      await grant(adminAccount, await role('system', 'tenant', []));
      admin = await contextOf(session.sessionToken);
    });

    it('creates a local account, which its first sign-in links and its next one reuses', async () => {
      const username = unique('Local').toUpperCase();
      const created = await identity.create.execute(admin, { username: `  ${username} ` });
      if (!created.ok) throw new Error(created.error.code);
      expect(await identity.create.execute(admin, { username })).toEqual({
        ok: false,
        error: { code: 'identity.account.username-taken' },
      });
      expect(await identity.create.execute(admin, { username: 'bad name' })).toEqual({
        ok: false,
        error: { code: 'identity.value.invalid', field: 'username' },
      });

      // A directory user of the same username is not the local account's person.
      expect(await signIn({ username: username.toLowerCase(), directory: true })).toEqual({
        ok: false,
        error: { code: 'sign-in.no-staff-account' },
      });
      const first = await signedIn({ username: username.toLowerCase(), directory: false });
      expect(first.accountId).toBe(created.value.id);
      expect(audit.actions()).toContain('identity.account.linked');
      const again = await signedIn({ username: username.toLowerCase(), directory: false });
      expect(again.accountId).toBe(created.value.id);
      // Another subject with the same username cannot take the linked account.
      expect(
        await signIn({ username: username.toLowerCase(), directory: false, subject: 'other' }),
      ).toEqual({ ok: false, error: { code: 'sign-in.no-staff-account' } });

      const listed = await identity.list.execute(admin, undefined);
      expect(listed.ok && listed.value.find((a) => a.id === created.value.id)).toMatchObject({
        source: 'local',
        status: 'active',
        username: username.toLowerCase(),
      });
    });

    it('disables a local account: its sessions end and it cannot sign in again', async () => {
      const username = unique('leaver');
      const created = await identity.create.execute(admin, { username });
      if (!created.ok) throw new Error(created.error.code);
      const one = await signedIn({ username, directory: false });
      const two = await signedIn({ username, directory: false });

      // The link of the first sign-in moved the version on: version 1 is stale.
      await expect(
        identity.disable.execute(admin, { accountId: created.value.id, version: 1 }),
      ).rejects.toThrow(StaleAggregateError);
      expect(
        await identity.disable.execute(admin, { accountId: created.value.id, version: 2 }),
      ).toEqual({ ok: true, value: { sessionsEnded: 2 } });
      for (const token of [one.sessionToken, two.sessionToken]) {
        expect((await identity.authenticator.authenticate(tenant, token)).ok).toBe(false);
      }
      expect(await signIn({ username, directory: false })).toEqual({
        ok: false,
        error: { code: 'sign-in.account-disabled', accountId: created.value.id },
      });
      expect(audit.actions()).toContain('identity.account.disabled');
    });

    it('refuses to disable a directory account, its own account and an unknown one', async () => {
      const directory = await signedIn({ username: unique('dir'), directory: true });
      expect(
        await identity.disable.execute(admin, { accountId: directory.accountId, version: 1 }),
      ).toEqual({ ok: false, error: { code: 'identity.account.not-local' } });
      expect(
        await identity.disable.execute(admin, { accountId: adminAccount, version: 1 }),
      ).toEqual({ ok: false, error: { code: 'identity.account.own-account' } });
      expect(
        await identity.disable.execute(admin, { accountId: ids.next<'Account'>(), version: 1 }),
      ).toEqual({ ok: false, error: { code: 'identity.account.not-found' } });
    });

    it('decides from the roles on every call: a revoked grant counts on the next one', async () => {
      const session = await signedIn({ username: unique('viewer'), directory: true });
      const viewer = await contextOf(session.sessionToken);
      const viewRole = await role('custom', 'tenant', ['identity.accounts.view', 'unknown.key.x']);
      const assignment = await grant(session.accountId, viewRole);

      expect((await identity.list.execute(viewer, undefined)).ok).toBe(true);
      expect(await identity.create.execute(viewer, { username: unique('x') })).toEqual({
        ok: false,
        error: { code: 'access.denied' },
      });
      await sql(tenant, 'DELETE FROM identity.role_assignment WHERE id = $1', [assignment]);
      expect(await identity.list.execute(viewer, undefined)).toEqual({
        ok: false,
        error: { code: 'access.denied' },
      });
    });

    it('confers no tenant key through a site-scope role', async () => {
      const session = await signedIn({ username: unique('site'), directory: true });
      const siteRole = await role('custom', 'site', ['identity.accounts.view']);
      await grant(session.accountId, siteRole, randomUUID());
      expect(await identity.list.execute(await contextOf(session.sessionToken), undefined)).toEqual(
        { ok: false, error: { code: 'access.denied' } },
      );
    });

    it('signs out: the session ends and its cookie is refused', async () => {
      const session = await signedIn({ username: unique('out'), directory: true });
      const context = await contextOf(session.sessionToken);
      expect(await identity.signOut.execute(context, undefined)).toEqual({
        ok: true,
        value: undefined,
      });
      expect((await identity.authenticator.authenticate(tenant, session.sessionToken)).ok).toBe(
        false,
      );
      // An actor whose session ended is refused by the check too, even with the actor in hand.
      expect(await identity.viewOwn.execute(context, undefined)).toEqual({
        ok: false,
        error: { code: 'access.denied' },
      });
    });

    it('never shows another tenant its accounts', async () => {
      const listed = await identity.list.execute(admin, undefined);
      if (!listed.ok) throw new Error('list failed');
      expect(listed.value.length).toBeGreaterThan(0);
      await writer.query('BEGIN');
      try {
        await writer.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
          other.tenantId,
        ]);
        const { rows } = await writer.query(
          'SELECT 1 FROM identity.account WHERE id = ANY($1::uuid[])',
          [listed.value.map((a) => a.id)],
        );
        expect(rows).toEqual([]);
      } finally {
        await writer.query('ROLLBACK');
      }
    });

    describe('roles and grants (slice 1.6)', () => {
      const editKey = CONTENT_ITEMS_EDIT.key;

      /** A staff account that signed in once, and its context. */
      async function staffMember(prefix: string) {
        const session = await signedIn({ username: unique(prefix), directory: true });
        return { id: session.accountId, context: await contextOf(session.sessionToken) };
      }

      async function site(parentSiteId: Id<'Site'> | null): Promise<Id<'Site'>> {
        const id = ids.next<'Site'>();
        const done = await persistence.unitOfWork.run(tenant, async () =>
          ok(
            await identity.sites.insert(
              tenant,
              {
                id,
                parentSiteId,
                organizationId: null,
                slug: unique('s'),
                name: 'سایت',
                depth: parentSiteId === null ? 0 : 1,
              },
              clock.now(),
            ),
          ),
        );
        if (!done.ok || done.value !== 'created') throw new Error('site setup failed');
        return id;
      }

      async function customRole(
        scope: 'tenant' | 'site',
        permissionKeys: string[],
        by: CallContext = admin,
      ): Promise<Id<'Role'>> {
        const created = await identity.createRole.execute(by, {
          key: unique(scope),
          scope,
          permissionKeys,
        });
        if (!created.ok) throw new Error(`role setup: ${created.error.code}`);
        return created.value.id;
      }

      async function assigned(
        accountId: Id<'Account'>,
        roleId: Id<'Role'>,
        placement: Parameters<typeof identity.assign.execute>[1]['placement'] = {
          level: 'tenant',
        },
        by: CallContext = admin,
      ): Promise<Id<'RoleAssignment'>> {
        const done = await identity.assign.execute(by, { accountId, roleId, placement });
        if (!done.ok) throw new Error(`grant setup: ${done.error.code}`);
        return done.value.id;
      }

      it('lists the staff permission catalogue and defines a custom role', async () => {
        const listed = await identity.listPermissions.execute(admin, undefined);
        expect(listed.ok && listed.value.map((d) => d.key)).toEqual(
          expect.arrayContaining(['identity.accounts.view', editKey]),
        );

        const key = unique('Reviewer').toUpperCase();
        const created = await identity.createRole.execute(admin, {
          key,
          scope: 'tenant',
          permissionKeys: ['identity.accounts.view', editKey],
        });
        if (!created.ok) throw new Error(created.error.code);
        expect(
          await identity.createRole.execute(admin, {
            key,
            scope: 'tenant',
            permissionKeys: [editKey],
          }),
        ).toEqual({ ok: false, error: { code: 'identity.role.key-taken' } });
        // A site role holds site keys only; an unknown key is no key.
        for (const permissionKeys of [['identity.accounts.view'], ['unknown.key.x'], []]) {
          expect(
            await identity.createRole.execute(admin, {
              key: unique('bad'),
              scope: 'site',
              permissionKeys,
            }),
          ).toEqual({
            ok: false,
            error: { code: 'identity.value.invalid', field: 'permissionKeys' },
          });
        }

        const roles = await identity.listRoles.execute(admin, undefined);
        expect(roles.ok && roles.value.find((r) => r.id === created.value.id)).toMatchObject({
          key: key.toLowerCase(),
          kind: 'custom',
          scope: 'tenant',
          permissionKeys: [editKey, 'identity.accounts.view'],
          version: 1,
        });
        expect(audit.actions()).toContain('identity.role.created');
      });

      it('changes a custom role with its version, never a system role', async () => {
        const roleId = await customRole('tenant', ['identity.accounts.view']);
        expect(
          await identity.changeRole.execute(admin, {
            roleId,
            version: 1,
            permissionKeys: ['identity.accounts.view', editKey],
          }),
        ).toEqual({ ok: true, value: undefined });
        await expect(
          identity.changeRole.execute(admin, { roleId, version: 1, permissionKeys: [editKey] }),
        ).rejects.toThrow(StaleAggregateError);
        const system = await role('system', 'tenant', []);
        expect(
          await identity.changeRole.execute(admin, {
            roleId: system as Id<'Role'>,
            version: 1,
            permissionKeys: [editKey],
          }),
        ).toEqual({ ok: false, error: { code: 'identity.role.not-editable' } });
        expect(
          await identity.changeRole.execute(admin, {
            roleId: ids.next<'Role'>(),
            version: 1,
            permissionKeys: [editKey],
          }),
        ).toEqual({ ok: false, error: { code: 'identity.role.not-found' } });
        expect(audit.actions()).toContain('identity.role.permissions-changed');
      });

      it('lets a delegate define roles only from its own unprotected keys', async () => {
        const delegate = await staffMember('delegate');
        await assigned(
          delegate.id,
          await customRole('tenant', ['identity.roles.manage', 'identity.accounts.view']),
        );
        expect(
          await identity.createRole.execute(delegate.context, {
            key: unique('r'),
            scope: 'tenant',
            permissionKeys: ['identity.accounts.view'],
          }),
        ).toMatchObject({ ok: true });
        for (const permissionKeys of [[editKey], ['identity.roles.manage']]) {
          expect(
            await identity.createRole.execute(delegate.context, {
              key: unique('r'),
              scope: 'tenant',
              permissionKeys,
            }),
          ).toMatchObject({ ok: false, error: { code: 'role.not-grantable' } });
        }
      });

      it('grants a role that counts on the next request, once, and revokes it', async () => {
        const member = await staffMember('member');
        const viewer = await customRole('tenant', ['identity.accounts.view']);
        expect((await identity.list.execute(member.context, undefined)).ok).toBe(false);

        const grant = await assigned(member.id, viewer);
        expect((await identity.list.execute(member.context, undefined)).ok).toBe(true);
        expect(
          await identity.assign.execute(admin, {
            accountId: member.id,
            roleId: viewer,
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'identity.role-assignment.exists' } });
        const grants = await identity.listGrants.execute(admin, { accountId: member.id });
        expect(grants.ok && grants.value.map((g) => [g.id, g.role.id, g.level])).toEqual([
          [grant, viewer, 'tenant'],
        ]);

        expect(await identity.revoke.execute(admin, { assignmentId: grant })).toEqual({
          ok: true,
          value: undefined,
        });
        expect((await identity.list.execute(member.context, undefined)).ok).toBe(false);
        expect(await identity.revoke.execute(admin, { assignmentId: grant })).toEqual({
          ok: false,
          error: { code: 'identity.role-assignment.not-found' },
        });
        expect(audit.actions()).toEqual(
          expect.arrayContaining(['identity.role.assigned', 'identity.role.revoked']),
        );
      });

      it('answers the role holdings of an account for the task inbox, on every call (ADR-0025)', async () => {
        const member = await staffMember('holder');
        const peer = await staffMember('peer');
        const fars = await site(null);
        const reviewer = await customRole('site', [editKey]);
        const grant = await assigned(member.id, reviewer, {
          level: 'site',
          siteId: fars,
          includeDescendants: true,
        });
        const expected = [
          {
            roleId: reviewer,
            scope: { level: 'site', siteId: fars, includeDescendants: true },
            keys: new Set([editKey]),
          },
        ];
        expect(await identity.roleHoldings.holdingsOf(peer.context, member.id)).toEqual(expected);
        expect(await identity.roleHoldings.holdingsOf(member.context, member.id)).toEqual(expected);
        // Only staff ask; an unknown account holds nothing.
        expect(
          await identity.roleHoldings.holdingsOf(testCallContext(tenant, 'system'), member.id),
        ).toEqual([]);
        expect(await identity.roleHoldings.holdingsOf(peer.context, ids.next<'Account'>())).toEqual(
          [],
        );
        expect(await identity.revoke.execute(admin, { assignmentId: grant })).toMatchObject({
          ok: true,
        });
        expect(await identity.roleHoldings.holdingsOf(peer.context, member.id)).toEqual([]);
      });

      it("answers the caller's own permission keys for the panel menu, on every call (slice 1.10)", async () => {
        const member = await staffMember('menu');
        const fars = await site(null);
        const viewer = await customRole('tenant', ['identity.accounts.view']);
        const editor = await customRole('site', [editKey]);
        expect(await identity.viewOwnPermissions.execute(member.context, undefined)).toEqual({
          ok: true,
          value: { tenant: [], sites: [] },
        });
        await assigned(member.id, viewer, { level: 'tenant' });
        const grant = await assigned(member.id, editor, {
          level: 'site',
          siteId: fars,
          includeDescendants: true,
        });
        expect(await identity.viewOwnPermissions.execute(member.context, undefined)).toEqual({
          ok: true,
          value: {
            tenant: ['identity.accounts.view'],
            sites: [{ siteId: fars, includeDescendants: true, keys: [editKey] }],
          },
        });
        // A revoke applies on the next request: nothing is cached.
        expect(await identity.revoke.execute(admin, { assignmentId: grant })).toMatchObject({
          ok: true,
        });
        expect(await identity.viewOwnPermissions.execute(member.context, undefined)).toEqual({
          ok: true,
          value: { tenant: ['identity.accounts.view'], sites: [] },
        });
        // Anonymous callers are refused by the gate.
        expect(
          (await identity.viewOwnPermissions.execute(testCallContext(tenant, 'anonymous'), undefined))
            .ok,
        ).toBe(false);
      });

      it('refuses a grant to an unlinked local account, itself, or a role of another level (M1)', async () => {
        const local = await identity.create.execute(admin, { username: unique('fresh') });
        if (!local.ok) throw new Error(local.error.code);
        const viewer = await customRole('tenant', ['identity.accounts.view']);
        expect(
          await identity.assign.execute(admin, {
            accountId: local.value.id,
            roleId: viewer,
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'identity.account.not-linked' } });
        expect(
          await identity.assign.execute(admin, {
            accountId: adminAccount,
            roleId: viewer,
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'member.self' } });

        const member = await staffMember('placed');
        const editor = await customRole('site', [editKey]);
        expect(
          await identity.assign.execute(admin, {
            accountId: member.id,
            roleId: editor,
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'role.not-grantable', reason: 'placement' } });
        expect(
          await identity.assign.execute(admin, {
            accountId: member.id,
            roleId: editor,
            placement: { level: 'site', siteId: ids.next<'Site'>(), includeDescendants: false },
          }),
        ).toEqual({ ok: false, error: { code: 'identity.site.not-found' } });
      });

      it('lets a site administrator grant only inside its subtree (ADR-0018 decision 6)', async () => {
        const parent = await site(null);
        const child = await site(parent);
        const sibling = await site(null);
        const siteAdmin = await customRole('site', ['identity.role-assignments.manage', editKey]);
        const editor = await customRole('site', [editKey]);
        const manager = await staffMember('site-admin');
        await assigned(manager.id, siteAdmin, {
          level: 'site',
          siteId: parent,
          includeDescendants: true,
        });
        const member = await staffMember('editor');
        const onSite = (siteId: Id<'Site'>) => ({
          accountId: member.id,
          roleId: editor,
          placement: { level: 'site' as const, siteId, includeDescendants: false },
        });

        const below = await identity.assign.execute(manager.context, onSite(child));
        expect(below.ok).toBe(true);
        expect(await identity.assign.execute(manager.context, onSite(sibling))).toEqual({
          ok: false,
          error: { code: 'role.not-grantable', reason: 'subtree' },
        });
        // Its own protected key it cannot hand out: only a system role holder can.
        expect(
          await identity.assign.execute(manager.context, {
            accountId: member.id,
            roleId: siteAdmin,
            placement: { level: 'site', siteId: child, includeDescendants: false },
          }),
        ).toEqual({ ok: false, error: { code: 'role.not-grantable', reason: 'protected-key' } });
        // It takes back what it gave, not what lies outside its reach.
        const outside = await assigned(member.id, editor, {
          level: 'site',
          siteId: sibling,
          includeDescendants: false,
        });
        // Beyond its reach a grant is another owner's: not found (security review, M2).
        expect(await identity.revoke.execute(manager.context, { assignmentId: outside })).toEqual({
          ok: false,
          error: { code: 'identity.role-assignment.not-found' },
        });
        if (!below.ok) throw new Error('grant failed');
        expect(
          await identity.revoke.execute(manager.context, { assignmentId: below.value.id }),
        ).toEqual({ ok: true, value: undefined });
      });

      it('lets only a system role holder change a role that has holders', async () => {
        const delegate = await staffMember('shaper');
        await assigned(
          delegate.id,
          await customRole('tenant', ['identity.roles.manage', 'identity.accounts.view']),
        );
        const shared = await customRole('tenant', ['identity.accounts.view'], delegate.context);
        const change = () =>
          identity.changeRole.execute(delegate.context, {
            roleId: shared,
            version: 1,
            permissionKeys: ['identity.accounts.view'],
          });
        expect(await change()).toEqual({ ok: true, value: undefined });
        await assigned((await staffMember('holder')).id, shared);
        expect(
          await identity.changeRole.execute(delegate.context, {
            roleId: shared,
            version: 2,
            permissionKeys: ['identity.accounts.view'],
          }),
        ).toEqual({ ok: false, error: { code: 'role.not-grantable', reason: 'system-role' } });
      });

      it('refuses a role to a disabled account, and ids of another tenant', async () => {
        const name = unique('gone');
        const local = await identity.create.execute(admin, { username: name });
        if (!local.ok) throw new Error(local.error.code);
        await signedIn({ username: name, directory: false });
        await identity.disable.execute(admin, { accountId: local.value.id, version: 2 });
        const viewer = await customRole('tenant', ['identity.accounts.view']);
        expect(
          await identity.assign.execute(admin, {
            accountId: local.value.id,
            roleId: viewer,
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'identity.account.disabled' } });

        // The other tenant's account, role and grant are not found here (row-level security).
        const member = await staffMember('here');
        await assigned(member.id, viewer);
        const foreign = await persistence.unitOfWork.run(
          other,
          async () => ok(await new PrismaRoleRepository(persistence.service).list(other)),
          { readOnly: true },
        );
        expect(foreign.ok && foreign.value.some((r) => r.id === viewer)).toBe(false);
        expect(
          await identity.assign.execute(admin, {
            accountId: ids.next<'Account'>(),
            roleId: viewer,
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'identity.account.not-found' } });
        expect(
          await identity.assign.execute(admin, {
            accountId: member.id,
            roleId: ids.next<'Role'>(),
            placement: { level: 'tenant' },
          }),
        ).toEqual({ ok: false, error: { code: 'identity.role.not-found' } });
      });

      it('keeps a system role holder when two holders revoke each other at once', async () => {
        const system = await role('system', 'tenant', []);
        const one = await staffMember('one');
        const two = await staffMember('two');
        const grantOne = await grant(one.id, system);
        const grantTwo = await grant(two.id, system);
        const results = await Promise.allSettled([
          identity.revoke.execute(one.context, { assignmentId: grantTwo as Id<'RoleAssignment'> }),
          identity.revoke.execute(two.context, { assignmentId: grantOne as Id<'RoleAssignment'> }),
        ]);
        // The admin of the suite also holds a system role, so both may succeed only in turn:
        // whichever runs second has lost its own system role and is refused. Under load the
        // second can instead keep losing the serializable race until its retries run out, which
        // answers 409 conflict.retry: also a refusal, so either outcome is accepted, never both
        // revokes succeeding.
        const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
        const refused = results.filter(
          (r) =>
            (r.status === 'fulfilled' && !r.value.ok) ||
            (r.status === 'rejected' && r.reason instanceof TransactionConflictError),
        );
        expect(succeeded).toHaveLength(1);
        expect(refused).toHaveLength(1);
        // And in the database: exactly one of the two grants is left.
        const left = [];
        for (const member of [one, two]) {
          const grants = await identity.listGrants.execute(admin, { accountId: member.id });
          if (!grants.ok) throw new Error(grants.error.code);
          left.push(...grants.value.filter((g) => g.id === grantOne || g.id === grantTwo));
        }
        expect(left).toHaveLength(1);
      });

      it('refuses disabling an account that outranks the actor', async () => {
        const manager = await staffMember('hr');
        await assigned(
          manager.id,
          await customRole('tenant', ['identity.accounts.manage', 'identity.accounts.view']),
        );
        const peerName = unique('peer');
        const peer = await identity.create.execute(admin, { username: peerName });
        if (!peer.ok) throw new Error(peer.error.code);
        await signedIn({ username: peerName, directory: false });
        // The peer holds a key the manager does not.
        await assigned(peer.value.id, await customRole('tenant', [editKey]));
        expect(
          await identity.disable.execute(manager.context, { accountId: peer.value.id, version: 2 }),
        ).toEqual({ ok: false, error: { code: 'member.outranks-actor' } });
        // The administrator holds every key: it may.
        expect(
          await identity.disable.execute(admin, { accountId: peer.value.id, version: 2 }),
        ).toMatchObject({ ok: true });
      });

      it('keeps one grant per place and the grant at its role level in the database', async () => {
        const member = await staffMember('db');
        const viewer = await role('custom', 'tenant', ['identity.accounts.view']);
        await grant(member.id, viewer);
        await expect(grant(member.id, viewer)).rejects.toMatchObject({
          constraint: 'role_assignment_tenant_id_account_id_role_id_site_id_key',
        });
        await expect(grant(member.id, viewer, randomUUID())).rejects.toMatchObject({
          constraint: 'role_assignment_role_fkey',
        });
      });
    });

    describe('field-level access (slice 2.0, ADR-0024)', () => {
      const READ = RECORDS_READ.key;
      const UPDATE = RECORDS_UPDATE.key;
      const DEF_A = ids.next<'Definition'>();
      const DEF_B = ids.next<'Definition'>();
      const NAME = ids.next<'Field'>();
      const NOTE = ids.next<'Field'>();
      const NATIONAL_ID = ids.next<'Field'>();
      const FIELDS: FieldDescriptor[] = [
        { id: NAME, sensitive: false },
        { id: NOTE, sensitive: false },
        { id: NATIONAL_ID, sensitive: true },
      ];
      const request = (definitionId: Id<'Definition'>): FieldRequest => ({
        definitionId,
        operations: { read: READ, write: UPDATE },
        fields: FIELDS,
      });

      async function staffMember(prefix: string) {
        const session = await signedIn({ username: unique(prefix), directory: true });
        return { id: session.accountId, context: await contextOf(session.sessionToken) };
      }

      async function customRole(permissionKeys: string[], by: CallContext = admin) {
        const created = await identity.createRole.execute(by, {
          key: unique('fields'),
          scope: 'tenant',
          permissionKeys,
        });
        if (!created.ok) throw new Error(`role setup: ${created.error.code}`);
        return created.value.id;
      }

      async function assigned(accountId: Id<'Account'>, roleId: Id<'Role'>, by = admin) {
        const done = await identity.assign.execute(by, {
          accountId,
          roleId,
          placement: { level: 'tenant' },
        });
        if (!done.ok) throw new Error(`grant setup: ${done.error.code}`);
        return done.value.id;
      }

      const modes = async (context: CallContext, definitionId: Id<'Definition'>) => {
        const access = await resolveFieldAccess(
          identity.fieldRules,
          identity.ancestry,
          context,
          null,
          request(definitionId),
        );
        return { ...access, modes: Object.fromEntries(access.modes) };
      };

      it('qualifies a key, sets field rules, and the reader answers them on the next request', async () => {
        const roleId = await customRole([READ, UPDATE]);
        const member = await staffMember('fields');
        await assigned(member.id, roleId);
        // A qualified key without a qualifier covers no definition.
        expect(await modes(member.context, DEF_A)).toMatchObject({ canRead: false });

        expect(
          await identity.changeScope.execute(admin, {
            roleId,
            version: 1,
            permissionKey: READ,
            definitions: 'all',
          }),
        ).toEqual({ ok: true, value: undefined });
        expect(
          await identity.changeScope.execute(admin, {
            roleId,
            version: 2,
            permissionKey: UPDATE,
            definitions: [DEF_A],
          }),
        ).toEqual({ ok: true, value: undefined });
        expect(await modes(member.context, DEF_A)).toEqual({
          canRead: true,
          canWrite: true,
          modes: { [NAME]: 'edit', [NOTE]: 'edit', [NATIONAL_ID]: 'hidden' },
        });
        expect(await modes(member.context, DEF_B)).toMatchObject({
          canWrite: false,
          modes: { [NAME]: 'read', [NOTE]: 'read', [NATIONAL_ID]: 'hidden' },
        });

        const rules = [
          { fieldId: NOTE, mode: 'hidden' as const },
          { fieldId: NATIONAL_ID, mode: 'read' as const },
        ];
        expect(
          await identity.changeFieldRules.execute(admin, {
            roleId,
            version: 3,
            definitionId: DEF_A,
            rules,
          }),
        ).toEqual({ ok: true, value: undefined });
        expect((await modes(member.context, DEF_A)).modes).toEqual({
          [NAME]: 'edit',
          [NOTE]: 'hidden',
          [NATIONAL_ID]: 'read',
        });
        expect(
          await identity.viewFieldRules.execute(admin, { roleId, definitionId: DEF_A }),
        ).toEqual({
          ok: true,
          value: { version: 4, rules: [...rules].sort((a, b) => (a.fieldId < b.fieldId ? -1 : 1)) },
        });
        await expect(
          identity.changeFieldRules.execute(admin, {
            roleId,
            version: 3,
            definitionId: DEF_A,
            rules: [],
          }),
        ).rejects.toThrow(StaleAggregateError);

        const listed = await identity.listRoles.execute(admin, undefined);
        expect(listed.ok && listed.value.find((r) => r.id === roleId)).toMatchObject({
          version: 4,
          definitionScopes: [
            { permissionKey: READ, allDefinitions: true, definitionIds: [] },
            { permissionKey: UPDATE, allDefinitions: false, definitionIds: [DEF_A] },
          ],
        });
        const entries = audit.entries.filter((entry) => entry.targetId === roleId);
        expect(entries.map((entry) => entry.action)).toEqual([
          'identity.role.created',
          'identity.role.definition-scope-changed',
          'identity.role.definition-scope-changed',
          'identity.role.field-rules-changed',
        ]);
        expect(entries[3]?.after).toEqual({
          definitionId: DEF_A,
          hidden: [NOTE],
          read: [NATIONAL_ID],
          edit: [],
        });

        // Removing the qualifier and revoking the role count on the next request too.
        expect(
          await identity.changeScope.execute(admin, {
            roleId,
            version: 4,
            permissionKey: UPDATE,
            definitions: 'none',
          }),
        ).toEqual({ ok: true, value: undefined });
        expect(await modes(member.context, DEF_A)).toMatchObject({ canWrite: false });
      });

      it('drops the qualifier of a key the role no longer confers (review L3)', async () => {
        const roleId = await customRole([READ, UPDATE]);
        await identity.changeScope.execute(admin, {
          roleId,
          version: 1,
          permissionKey: UPDATE,
          definitions: 'all',
        });
        for (const [version, permissionKeys] of [
          [2, [READ]],
          [3, [READ, UPDATE]],
        ] as const) {
          expect(
            await identity.changeRole.execute(admin, {
              roleId,
              version,
              permissionKeys: [...permissionKeys],
            }),
          ).toEqual({ ok: true, value: undefined });
        }
        const listed = await identity.listRoles.execute(admin, undefined);
        expect(listed.ok && listed.value.find((r) => r.id === roleId)?.definitionScopes).toEqual(
          [],
        );
      });

      it('refuses a key that is not qualified or not conferred, and a system role', async () => {
        const roleId = await customRole([READ, CONTENT_ITEMS_EDIT.key]);
        for (const permissionKey of [CONTENT_ITEMS_EDIT.key, UPDATE, 'unknown.key.x']) {
          expect(
            await identity.changeScope.execute(admin, {
              roleId,
              version: 1,
              permissionKey,
              definitions: 'all',
            }),
          ).toEqual({
            ok: false,
            error: { code: 'identity.value.invalid', field: 'permissionKey' },
          });
        }
        expect(
          await identity.changeScope.execute(admin, {
            roleId,
            version: 1,
            permissionKey: READ,
            definitions: [DEF_A, DEF_A],
          }),
        ).toEqual({ ok: false, error: { code: 'identity.value.invalid', field: 'definitionIds' } });
        const system = (await role('system', 'tenant', [])) as Id<'Role'>;
        expect(
          await identity.changeFieldRules.execute(admin, {
            roleId: system,
            version: 1,
            definitionId: DEF_A,
            rules: [],
          }),
        ).toEqual({ ok: false, error: { code: 'identity.role.not-editable' } });
      });

      it('lets a delegate hand out no wider definitions or fields than it holds (decision 10)', async () => {
        const delegateRole = await customRole(['identity.roles.manage', READ, UPDATE]);
        const scope = (
          roleId: Id<'Role'>,
          version: number,
          permissionKey: string,
          definitions: 'all' | 'none' | Id<'Definition'>[],
          by = admin,
        ) => identity.changeScope.execute(by, { roleId, version, permissionKey, definitions });
        await scope(delegateRole, 1, READ, [DEF_A]);
        await scope(delegateRole, 2, UPDATE, [DEF_A]);
        await identity.changeFieldRules.execute(admin, {
          roleId: delegateRole,
          version: 3,
          definitionId: DEF_A,
          rules: [{ fieldId: NOTE, mode: 'hidden' }],
        });
        const delegate = await staffMember('field-delegate');
        await assigned(delegate.id, delegateRole);

        const shaped = await customRole([READ, UPDATE], delegate.context);
        const refused = (reason: string) => ({
          ok: false,
          error: { code: 'role.not-grantable', reason },
        });
        expect(await scope(shaped, 1, READ, 'all', delegate.context)).toEqual(
          refused('definition'),
        );
        expect(await scope(shaped, 1, READ, [DEF_B], delegate.context)).toEqual(
          refused('definition'),
        );
        // DEF_A is within reach, but the delegate's own narrowing of NOTE must come along.
        expect(await scope(shaped, 1, READ, [DEF_A], delegate.context)).toEqual(
          refused('field-rules'),
        );
        expect(
          await identity.changeFieldRules.execute(delegate.context, {
            roleId: shaped,
            version: 1,
            definitionId: DEF_A,
            rules: [{ fieldId: NOTE, mode: 'hidden' }],
          }),
        ).toEqual({ ok: true, value: undefined });
        expect(await scope(shaped, 2, READ, [DEF_A], delegate.context)).toEqual({
          ok: true,
          value: undefined,
        });
        // Opening a sensitive field the delegate cannot see itself is refused.
        expect(
          await identity.changeFieldRules.execute(delegate.context, {
            roleId: shaped,
            version: 3,
            definitionId: DEF_A,
            rules: [
              { fieldId: NOTE, mode: 'hidden' },
              { fieldId: NATIONAL_ID, mode: 'read' },
            ],
          }),
        ).toEqual(refused('field-rules'));

        // A role made wider by the administrator cannot be granted by the delegate.
        const wide = await customRole([READ]);
        await scope(wide, 1, READ, 'all');
        const delegateGrants = await customRole([
          'identity.role-assignments.manage',
          'identity.roles.manage',
          READ,
          UPDATE,
        ]);
        await scope(delegateGrants, 1, READ, [DEF_A]);
        const granter = await staffMember('field-granter');
        await assigned(granter.id, delegateGrants);
        const target = await staffMember('field-target');
        expect(
          await identity.assign.execute(granter.context, {
            accountId: target.id,
            roleId: wide,
            placement: { level: 'tenant' },
          }),
        ).toEqual(refused('definition'));
      });

      it('keeps the qualifier and rule rows valid and inside their tenant in the database', async () => {
        const roleId = await role('custom', 'tenant', [READ]);
        await expect(
          sql(
            tenant,
            `INSERT INTO identity.role_definition_scope (tenant_id, role_id, permission_key, all_definitions, definition_ids)
             VALUES ($1, $2, $3, true, $4)`,
            [tenant.tenantId, roleId, READ, [DEF_A]],
          ),
        ).rejects.toMatchObject({ constraint: 'role_definition_scope_definition_ids_check' });
        await expect(
          sql(
            tenant,
            `INSERT INTO identity.role_field_rule (tenant_id, role_id, definition_id, field_id, mode)
             VALUES ($1, $2, $3, $4, 'write')`,
            [tenant.tenantId, roleId, DEF_A, NAME],
          ),
        ).rejects.toMatchObject({ constraint: 'role_field_rule_mode_check' });
        await sql(
          tenant,
          `INSERT INTO identity.role_field_rule (tenant_id, role_id, definition_id, field_id, mode)
           VALUES ($1, $2, $3, $4, 'read')`,
          [tenant.tenantId, roleId, DEF_A, NAME],
        );
        // Row-level security: the other tenant neither sees nor writes this tenant's rows.
        await writer.query('BEGIN');
        try {
          await writer.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
            other.tenantId,
          ]);
          const seen = await writer.query(
            'SELECT count(*)::int AS n FROM identity.role_field_rule WHERE role_id = $1',
            [roleId],
          );
          expect(seen.rows[0]).toEqual({ n: 0 });
        } finally {
          await writer.query('ROLLBACK');
        }
        await expect(
          sql(
            other,
            `INSERT INTO identity.role_field_rule (tenant_id, role_id, definition_id, field_id, mode)
             VALUES ($1, $2, $3, $4, 'read')`,
            [tenant.tenantId, roleId, DEF_A, NOTE],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });

    describe('the directory sync (owner decision P6)', () => {
      const system = testCallContext(tenant, 'system');
      /** "Sync now" a minute after whatever ran before: past the 30 s cooldown. */
      const syncNow = (context: CallContext = admin) => {
        clock.advance(Temporal.Duration.from({ minutes: 1 }));
        return identity.syncNow.execute(context, undefined);
      };
      const statusOf = async (accountId: Id<'Account'>) => {
        const listed = await identity.list.execute(admin, undefined);
        if (!listed.ok) throw new Error('list failed');
        return listed.value.find((account) => account.id === accountId)?.status;
      };

      it('runs on schedule only once the interval has passed, and "sync now" at any time', async () => {
        const first = await identity.sync.execute(system, undefined);
        expect(first).toMatchObject({ ok: true, value: { outcome: 'completed' } });
        expect(await identity.sync.execute(system, undefined)).toMatchObject({
          ok: true,
          value: { outcome: 'skipped' },
        });
        // "Sync now" right after a start is skipped; a minute later it runs.
        expect(await identity.syncNow.execute(admin, undefined)).toMatchObject({
          ok: true,
          value: { outcome: 'skipped' },
        });
        expect(await syncNow()).toMatchObject({
          ok: true,
          value: { outcome: 'completed' },
        });
        clock.advance(Temporal.Duration.from({ minutes: 5 }));
        expect(await identity.sync.execute(system, undefined)).toMatchObject({
          ok: true,
          value: { outcome: 'completed' },
        });
        const state = await identity.viewSync.execute(admin, undefined);
        expect(state.ok && state.value).toMatchObject({
          intervalMinutes: 5,
          lastOutcome: 'completed',
          lastStartedAt: clock.now(),
        });
        // The scheduled use case is the system actor's only; "sync now" needs the manage key.
        expect(await identity.sync.execute(admin, undefined)).toEqual({
          ok: false,
          error: { code: 'access.denied' },
        });
        const plain = await contextOf(
          (await signedIn({ username: unique('plain'), directory: true })).sessionToken,
        );
        for (const refused of [
          await syncNow(plain),
          await identity.viewSync.execute(plain, undefined),
          await identity.setInterval.execute(plain, { version: 1, intervalMinutes: 10 }),
        ]) {
          expect(refused).toEqual({ ok: false, error: { code: 'access.denied' } });
        }
      });

      it('runs once when two scheduled runs start together', async () => {
        clock.advance(Temporal.Duration.from({ minutes: 60 }));
        const runs = await Promise.all([
          identity.sync.execute(system, undefined),
          identity.sync.execute(system, undefined),
        ]);
        expect(runs.map((run) => run.ok && run.value.outcome).sort()).toEqual([
          'completed',
          'skipped',
        ]);
      });

      it('disables a person disabled or gone in AD, ends their sessions, and re-enables them', async () => {
        const goneName = unique('gone');
        const offName = unique('off');
        const gone = await signedIn({ username: goneName, directory: true });
        const off = await signedIn({ username: offName, directory: true });
        const localName = unique('loc');
        const local = await identity.create.execute(admin, { username: localName });
        if (!local.ok) throw new Error(local.error.code);
        // A linked local account: the directory never decides about it, even when it says gone.
        await signedIn({ username: localName, directory: false });
        directory.statuses.set(`sub-${localName}`, 'missing');
        directory.statuses.set(`sub-${goneName}`, 'missing');
        directory.statuses.set(`sub-${offName}`, 'disabled');

        const ran = await syncNow();
        expect(ran).toMatchObject({
          ok: true,
          value: { outcome: 'completed', accountsDisabled: 2 },
        });
        expect(await statusOf(gone.accountId)).toBe('disabled');
        expect(await statusOf(off.accountId)).toBe('disabled');
        expect(await statusOf(local.value.id)).toBe('active');
        for (const token of [gone.sessionToken, off.sessionToken]) {
          expect((await identity.authenticator.authenticate(tenant, token)).ok).toBe(false);
        }
        expect(audit.actions()).toContain('identity.account.disabled-by-directory');

        directory.statuses.set(`sub-${offName}`, 'enabled');
        expect(await syncNow()).toMatchObject({
          ok: true,
          value: { outcome: 'completed', accountsDisabled: 0, accountsEnabled: 1 },
        });
        expect(await statusOf(off.accountId)).toBe('active');
        expect(await statusOf(gone.accountId)).toBe('disabled');
        expect(audit.actions()).toContain('identity.account.enabled-by-directory');
        // Re-enabled, the person signs in again: the old sessions stay ended.
        expect((await identity.authenticator.authenticate(tenant, off.sessionToken)).ok).toBe(
          false,
        );
      });

      it('changes nothing when the directory does not answer, or would disable most accounts', async () => {
        const keptName = unique('kept');
        const kept = await signedIn({ username: keptName, directory: true });
        directory.statuses.set(`sub-${keptName}`, 'disabled');
        directory.down = true;
        expect(await syncNow()).toMatchObject({
          ok: true,
          value: { outcome: 'failed', accountsDisabled: 0 },
        });
        directory.down = false;
        expect(await statusOf(kept.accountId)).toBe('active');

        // Ten or more accounts, all of them reported gone: a broken link, not a mass leave.
        for (let n = 0; n < 10; n += 1)
          await signedIn({ username: unique('crowd'), directory: true });
        directory.everyone = 'missing';
        try {
          expect(await syncNow()).toMatchObject({
            ok: true,
            value: { outcome: 'halted', accountsDisabled: 0 },
          });
        } finally {
          directory.everyone = null;
        }
        expect(await statusOf(kept.accountId)).toBe('active');
        expect((await identity.authenticator.authenticate(tenant, kept.sessionToken)).ok).toBe(
          true,
        );
        const state = await identity.viewSync.execute(admin, undefined);
        expect(state.ok && state.value.lastOutcome).toBe('halted');
        expect(audit.actions()).toContain('identity.directory-sync.ran');
        directory.statuses.clear();
      });

      it('sets the interval within 1 to 60 minutes, with a version a run does not change', async () => {
        const before = await identity.viewSync.execute(admin, undefined);
        if (!before.ok) throw new Error('view failed');
        await syncNow();
        const { version } = before.value;
        // A different value per tenant fixture, so each sees only its own.
        const minutes = 15 + TEST_TENANTS.indexOf(code);
        for (const intervalMinutes of [0, 61]) {
          expect(await identity.setInterval.execute(admin, { version, intervalMinutes })).toEqual({
            ok: false,
            error: { code: 'identity.value.invalid', field: 'intervalMinutes' },
          });
        }
        expect(
          await identity.setInterval.execute(admin, { version, intervalMinutes: minutes }),
        ).toEqual({
          ok: true,
          value: undefined,
        });
        await expect(
          identity.setInterval.execute(admin, { version, intervalMinutes: 30 }),
        ).rejects.toThrow(StaleAggregateError);
        const after = await identity.viewSync.execute(admin, undefined);
        expect(after.ok && after.value).toMatchObject({
          intervalMinutes: minutes,
          version: version + 1,
        });
        expect(audit.actions()).toContain('identity.directory-sync.interval-changed');

        // Ten minutes after the last start is not due; the new interval is.
        clock.advance(Temporal.Duration.from({ minutes: 10 }));
        expect(await identity.sync.execute(system, undefined)).toMatchObject({
          ok: true,
          value: { outcome: 'skipped' },
        });
        clock.advance(Temporal.Duration.from({ minutes: minutes - 10 }));
        expect(await identity.sync.execute(system, undefined)).toMatchObject({
          ok: true,
          value: { outcome: 'completed' },
        });
        // The other tenant's setting is its own.
        const elsewhere = await persistence.unitOfWork.run(
          other,
          async () => ok(await new PrismaDirectorySyncRepository(persistence.service).read(other)),
          { readOnly: true },
        );
        expect(elsewhere.ok && elsewhere.value.intervalMinutes).not.toBe(minutes);
      });
    });
  });
});
