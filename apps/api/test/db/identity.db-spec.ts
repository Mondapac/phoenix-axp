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
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
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
import { IDENTITY_PERMISSIONS } from '../../src/modules/identity/contracts/permissions';
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
    const options = { isKnownPermissionKey: () => false };
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
    const declared = new Map<string, PermissionDeclaration>(
      IDENTITY_PERMISSIONS.declarations.map((d) => [d.key, d]),
    );
    const permissions = { get: (key: string) => declared.get(key) };
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
    return {
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
      list: new ListStaffAccounts(gate, uow, accounts),
      create: new CreateLocalStaffAccount(gate, uow, accounts, audit, clock, ids),
      disable: new DisableStaffAccount(gate, uow, accounts, sessions, audit, clock),
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
    const id = randomUUID();
    await sql(
      tenant,
      `INSERT INTO identity.role (id, tenant_id, key, kind, scope, permission_keys, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, now(), now())`,
      [id, tenant.tenantId, unique('role'), kind, scope, keys],
    );
    return id;
  }

  async function grant(accountId: string, roleId: string, siteId: string | null = null) {
    const id = randomUUID();
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

    describe('the directory sync (owner decision P6)', () => {
      const system = testCallContext(tenant, 'system');
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
        expect(await identity.syncNow.execute(admin, undefined)).toMatchObject({
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
        expect(await identity.syncNow.execute(plain, undefined)).toEqual({
          ok: false,
          error: { code: 'access.denied' },
        });
      });

      it('disables a person disabled or gone in AD, ends their sessions, and re-enables them', async () => {
        const goneName = unique('gone');
        const offName = unique('off');
        const gone = await signedIn({ username: goneName, directory: true });
        const off = await signedIn({ username: offName, directory: true });
        const local = await identity.create.execute(admin, { username: unique('loc') });
        if (!local.ok) throw new Error(local.error.code);
        directory.statuses.set(`sub-${goneName}`, 'missing');
        directory.statuses.set(`sub-${offName}`, 'disabled');

        const ran = await identity.syncNow.execute(admin, undefined);
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
        expect(await identity.syncNow.execute(admin, undefined)).toMatchObject({
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
        expect(await identity.syncNow.execute(admin, undefined)).toMatchObject({
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
          expect(await identity.syncNow.execute(admin, undefined)).toMatchObject({
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
        await identity.syncNow.execute(admin, undefined);
        const { version } = before.value;
        // A different value per tenant fixture, so each sees only its own.
        const minutes = 15 + TEST_TENANTS.indexOf(code);
        expect(await identity.setInterval.execute(admin, { version, intervalMinutes: 0 })).toEqual({
          ok: false,
          error: { code: 'identity.value.invalid', field: 'intervalMinutes' },
        });
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
