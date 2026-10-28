import { createHash, randomUUID } from 'node:crypto';
import { encodeAuditFields, ok, Temporal } from '@phoenix/shared-kernel';
import type { AuditEntry, CallContext, TenantContext } from '@phoenix/shared-kernel';
import {
  FixedClock,
  SequenceIdGenerator,
  testAuthenticatedActor,
  testCallContext,
} from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { AuditWriter } from '../../src/platform/audit/audit-writer';
import { PermissionRegistry } from '../../src/platform/authz/permission-registry';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { CaptchaService, type ProofOfWorkChallenge } from '../../src/platform/captcha';
import type { MailMessage, MailSender } from '../../src/platform/mail';
import { PrismaCaptchaSpentStore } from '../../src/platform/persistence/captcha/prisma-captcha-spent-store';
import { PrismaRateLimitStore } from '../../src/platform/persistence/rate-limit/prisma-rate-limit-store';
import { PrismaSubjectKeyStore } from '../../src/platform/persistence/subject-keys/prisma-subject-key-store';
import { PostgresRateLimiter, rateLimitKey } from '../../src/platform/rate-limit/rate-limiter';
import { MailRelaySmsSender } from '../../src/platform/sms/sms-sender';
import { SubjectKeyCipher } from '../../src/platform/subject-keys/subject-key-cipher';
import { SubjectKeyService } from '../../src/platform/subject-keys/subject-key.service';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
import { IdentityAuthorisationCheck } from '../../src/modules/identity/application/access/identity-authorisation-check';
import { SessionAuthenticator } from '../../src/modules/identity/application/access/session-authenticator';
import { PortalCodes } from '../../src/modules/identity/application/portal/portal-codes';
import { IssuePortalChallenge } from '../../src/modules/identity/application/use-cases/issue-portal-challenge.use-case';
import { PrunePortalCodes } from '../../src/modules/identity/application/use-cases/prune-portal-codes.use-case';
import { RequestPortalCode } from '../../src/modules/identity/application/use-cases/request-portal-code.use-case';
import { SignOut } from '../../src/modules/identity/application/use-cases/sign-out.use-case';
import { UpdatePortalSignInSettings } from '../../src/modules/identity/application/use-cases/update-portal-sign-in-settings.use-case';
import { VerifyPortalCode } from '../../src/modules/identity/application/use-cases/verify-portal-code.use-case';
import { ViewOwnAccount } from '../../src/modules/identity/application/use-cases/view-own-account.use-case';
import { ViewOwnPortalAccount } from '../../src/modules/identity/application/use-cases/view-own-portal-account.use-case';
import { ViewPortalSignInOptions } from '../../src/modules/identity/application/use-cases/view-portal-sign-in-options.use-case';
import { ViewPortalSignInSettings } from '../../src/modules/identity/application/use-cases/view-portal-sign-in-settings.use-case';
import { IDENTITY_PERMISSIONS } from '../../src/modules/identity/contracts/permissions';
import { IDENTITY_AUDIT_ACTIONS } from '../../src/modules/identity/domain/audit-actions';
import type { PortalMethod } from '../../src/modules/identity/domain/portal';
import { PrismaAccountRepository } from '../../src/modules/identity/infrastructure/prisma-account.repository';
import { PrismaPortalRepository } from '../../src/modules/identity/infrastructure/prisma-portal.repository';
import { PrismaSessionRepository } from '../../src/modules/identity/infrastructure/prisma-session.repository';
import {
  TEST_SUBJECT_KEY_KEK,
  TEST_TENANT_CONFIG_DIRS,
  TEST_TENANTS,
  testTenantId,
} from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { testDatabaseUrl } from './test-database';

// Phase 1 slice 1.8: portal sign-in with one-time codes (ADR-0026) against PostgreSQL, through
// the real repositories, unit of work, tenant guard, row-level security, CAPTCHA, rate limits
// and subject keys. Mail and SMS are captured in memory.

const DEFINITIONS = new Map(IDENTITY_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(context: CallContext, entry: AuditEntry): Promise<void> {
    const definition = DEFINITIONS.get(entry.action);
    if (definition === undefined) throw new Error(`undeclared audit action ${entry.action}`);
    expect(definition.actors).toContain(context.actor.kind);
    for (const [fields, values] of [
      [definition.before, entry.before],
      [definition.after, entry.after],
    ] as const) {
      if (fields === null) expect(values ?? null).toBeNull();
      else
        expect(encodeAuditFields(fields, values, { isKnownPermissionKey: () => true }).ok).toBe(
          true,
        );
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
}

/** Keeps every message; `down` refuses them. */
class CapturingMail implements MailSender {
  readonly available = true;
  readonly sent: MailMessage[] = [];
  down = false;
  send(_tenant: TenantContext, message: MailMessage) {
    if (this.down)
      return Promise.resolve({ ok: false as const, error: { code: 'mail.unavailable' as const } });
    this.sent.push(message);
    return Promise.resolve(ok(undefined));
  }
  /** The code of the last message to `to`. */
  codeTo(to: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    const code = /: (\d{6})\n/.exec(message?.text ?? '')?.[1];
    if (code === undefined) throw new Error(`no code sent to ${to}`);
    return code;
  }
}

/** Solves a challenge as the ALTCHA widget does, and returns its base64 JSON payload. */
function solve(challenge: ProofOfWorkChallenge): string {
  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    const hash = createHash('sha256').update(`${challenge.salt}${number}`).digest('hex');
    if (hash === challenge.challenge) {
      return Buffer.from(JSON.stringify({ ...challenge, number })).toString('base64');
    }
  }
  throw new Error('unsolvable');
}

const client = (): string => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
const email = (): string => `user.${randomUUID().slice(0, 8)}@example.test`;

/** A tenant's calling code and a national mobile number of it. */
const digits = (count: number): string =>
  String(Math.floor(Math.random() * 10 ** count)).padStart(count, '0');
const MOBILE: Readonly<Record<string, { code: string; national: () => string }>> = {
  // Persian digits and spaces, as a phone keyboard types them.
  fa: {
    code: '98',
    national: () =>
      `0912 ${digits(3)} ${digits(4)}`.replace(/[0-9]/g, (d) =>
        String.fromCharCode(0x06f0 + Number(d)),
      ),
  },
  en: { code: '44', national: () => `07700 ${digits(6)}` },
};

describe.each(TEST_TENANTS)('portal sign-in in tenant %s (database integration)', (code) => {
  const tenant = tenantOf(code);
  const other = tenantOf(otherTenantOf(code));
  const mobile = MOBILE[code.startsWith('demo-fa') ? 'fa' : 'en']!;
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-28T09:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  const mail = new CapturingMail();
  let persistence: Persistence;
  let writer: Client;
  let portal: ReturnType<typeof build>;

  function build(p: Persistence) {
    const permissions = new PermissionRegistry();
    permissions.register('identity', IDENTITY_PERMISSIONS);
    permissions.seal();
    const tenants = new TenantRegistry(
      loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANTS.map(testTenantId)),
    );
    const uow = p.unitOfWork;
    const sessions = new PrismaSessionRepository(p.service);
    const repository = new PrismaPortalRepository(p.service);
    const gate = createUseCaseGate(
      tenants,
      permissions,
      new IdentityAuthorisationCheck(uow, sessions, permissions, clock),
    );
    // The settings use cases need a staff key; their gate admits every caller here (the real
    // check of permissions has its own tests in identity.db-spec.ts).
    const openGate = createUseCaseGate(tenants, permissions, {
      check: () => Promise.resolve({ allowed: true }),
    });
    const secret = Buffer.from('test-only-session-secret-of-the-portal-spec');
    const captcha = new CaptchaService(
      secret,
      uow,
      new PrismaCaptchaSpentStore(p.service),
      clock,
      500,
    );
    const limiter = new PostgresRateLimiter(
      uow,
      new PrismaRateLimitStore(p.service),
      clock,
      rateLimitKey(secret),
    );
    const subjectKeys = new SubjectKeyService(
      new SubjectKeyCipher(Buffer.from(TEST_SUBJECT_KEY_KEK, 'base64url')),
      new PrismaSubjectKeyStore(p.service),
    );
    const sms = new MailRelaySmsSender(mail);
    const codes = new PortalCodes(secret);
    return {
      repository,
      accounts: new PrismaAccountRepository(p.service),
      authenticator: new SessionAuthenticator(uow, sessions, clock),
      options: new ViewPortalSignInOptions(gate, uow, repository, mail, sms),
      challenge: new IssuePortalChallenge(gate, captcha, limiter),
      request: new RequestPortalCode(
        gate,
        uow,
        repository,
        codes,
        captcha,
        limiter,
        subjectKeys,
        mail,
        sms,
        tenants,
        clock,
        ids,
      ),
      verify: new VerifyPortalCode(
        gate,
        uow,
        repository,
        codes,
        limiter,
        subjectKeys,
        sessions,
        audit,
        clock,
        ids,
        24,
      ),
      viewOwn: new ViewOwnPortalAccount(gate, uow, repository, subjectKeys),
      viewOwnStaff: new ViewOwnAccount(gate, uow, new PrismaAccountRepository(p.service)),
      signOut: new SignOut(gate, uow, sessions, audit),
      viewSettings: new ViewPortalSignInSettings(openGate, uow, repository, mail, sms),
      updateSettings: new UpdatePortalSignInSettings(openGate, uow, repository, audit, clock),
      prune: new PrunePortalCodes(gate, uow, repository, clock),
    };
  }

  const anonymous = (of: TenantContext = tenant) => testCallContext(of, 'anonymous');
  const staffCall = () =>
    testCallContext(
      tenant,
      testAuthenticatedActor(tenant, {
        population: 'tenant-staff',
        accountId: '0190f6e2-8b1c-7a00-8000-0000000000a1' as never,
        sessionId: '0190f6e2-8b1c-7a00-8000-0000000000b1' as never,
      }),
    );

  beforeAll(async () => {
    persistence = createPersistence();
    writer = new Client({ connectionString: testDatabaseUrl() });
    await writer.connect();
    portal = build(persistence);
  });

  afterAll(async () => {
    await writer.end();
    await persistence.close();
  });

  /** One statement as the application login in `of`'s tenant, committed; its rows. */
  async function sql<T = Record<string, unknown>>(
    of: TenantContext,
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await writer.query('BEGIN');
    try {
      await writer.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [of.tenantId]);
      const result = await writer.query(text, params);
      await writer.query('COMMIT');
      return result.rows as T[];
    } catch (error) {
      await writer.query('ROLLBACK');
      throw error;
    }
  }

  /** Opens both methods with the tenant's calling code, whatever was saved before. */
  async function openPortal(): Promise<void> {
    const current = await portal.viewSettings.execute(staffCall(), undefined);
    if (!current.ok) throw new Error('settings unreadable');
    const saved = await portal.updateSettings.execute(staffCall(), {
      version: current.value.version,
      methods: ['email', 'mobile'],
      countryCallingCode: mobile.code,
    });
    if (!saved.ok) throw new Error(`settings refused: ${saved.error.code}`);
  }

  async function sendCode(method: PortalMethod, address: string, of: TenantContext = tenant) {
    const challenge = await portal.challenge.execute(anonymous(of), { clientAddress: client() });
    if (!challenge.ok) throw new Error('no challenge');
    return portal.request.execute(anonymous(of), {
      method,
      address,
      captcha: solve(challenge.value),
      clientAddress: client(),
    });
  }

  async function sentCode(method: PortalMethod, address: string) {
    const sent = await sendCode(method, address);
    if (!sent.ok) throw new Error(`code refused: ${sent.error.code}`);
    return sent.value.challengeId;
  }

  it('is closed until the tenant opens a method; settings are versioned and audited', async () => {
    // A fresh run database: nothing saved, so nothing offered and no code sent.
    expect(await portal.options.execute(anonymous(), undefined)).toEqual(
      ok({ methods: [], countryCallingCode: null }),
    );
    expect(await sendCode('email', email())).toEqual({
      ok: false,
      error: { code: 'portal.method-unavailable' },
    });
    await openPortal();
    expect(await portal.options.execute(anonymous(), undefined)).toEqual(
      ok({ methods: ['email', 'mobile'], countryCallingCode: mobile.code }),
    );
    const settings = await portal.viewSettings.execute(staffCall(), undefined);
    expect(settings.ok && settings.value.deliverable).toEqual({ email: true, mobile: true });
    expect(
      audit.entries.some((entry) => entry.action === 'identity.portal-sign-in.settings-changed'),
    ).toBe(true);
    await expect(
      portal.updateSettings.execute(staffCall(), {
        version: 0,
        methods: ['email'],
        countryCallingCode: null,
      }),
    ).rejects.toBeInstanceOf(StaleAggregateError);
    expect(
      await portal.updateSettings.execute(staffCall(), {
        version: settings.ok ? settings.value.version : 0,
        methods: ['email', 'fax'],
        countryCallingCode: null,
      }),
    ).toEqual({ ok: false, error: { code: 'identity.value.invalid', field: 'methods' } });
  });

  it('signs a new user up with an emailed code, then signs them in again', async () => {
    await openPortal();
    const address = email();
    const first = await sentCode('email', address.toUpperCase());

    // Only hashes of the code and the address are stored.
    const [row] = await sql<{ lookup_hash: Buffer; code_hash: Buffer }>(
      tenant,
      'SELECT lookup_hash, code_hash FROM identity.portal_code WHERE id = $1',
      [first],
    );
    expect(row!.lookup_hash).toHaveLength(32);
    expect(row!.lookup_hash.includes(Buffer.from(address))).toBe(false);

    const wrong = String((Number(mail.codeTo(address)) + 1) % 1_000_000).padStart(6, '0');
    expect(
      await portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: first,
        method: 'email',
        address,
        code: wrong,
      }),
    ).toEqual({ ok: false, error: { code: 'portal.code-invalid' } });

    const signedUp = await portal.verify.execute(anonymous(), {
      clientAddress: client(),
      challengeId: first,
      method: 'email',
      address,
      code: mail.codeTo(address),
    });
    if (!signedUp.ok) throw new Error(signedUp.error.code);
    const accountId = signedUp.value.accountId;
    const provisioned = audit.entries.filter(
      (entry) => entry.action === 'identity.account.provisioned' && entry.targetId === accountId,
    );
    expect(provisioned).toHaveLength(1);
    expect(provisioned[0]!.after).toEqual({ boundSubjectId: accountId, source: 'one-time-code' });

    // The account row has no username; its address is sealed.
    const [account] = await sql<{ population: string; source: string; username: string | null }>(
      tenant,
      'SELECT population, source, username FROM identity.account WHERE id = $1',
      [accountId],
    );
    expect(account).toEqual({ population: 'portal-user', source: 'one-time-code', username: null });
    const [contact] = await sql<{ sealed: Buffer }>(
      tenant,
      'SELECT sealed FROM identity.portal_contact WHERE account_id = $1',
      [accountId],
    );
    expect(contact!.sealed.includes(Buffer.from(address))).toBe(false);

    // The session is a portal session: the portal cookie admits it, the studio cookie not.
    const token = signedUp.value.sessionToken;
    const actor = await portal.authenticator.authenticate(tenant, token, 'portal-user');
    expect(actor.ok).toBe(true);
    expect((await portal.authenticator.authenticate(tenant, token)).ok).toBe(false);
    expect((await portal.authenticator.authenticate(other, token, 'portal-user')).ok).toBe(false);
    if (!actor.ok) return;
    const signedIn = testCallContext(tenant, actor.value);
    const own = await portal.viewOwn.execute(signedIn, undefined);
    expect(own).toEqual(
      ok({
        accountId,
        contacts: [{ method: 'email', masked: `${address.slice(0, 2)}***@example.test` }],
      }),
    );
    // The staff "me" and the staff repository never see a portal account.
    expect(await portal.viewOwnStaff.execute(signedIn, undefined)).toEqual({
      ok: false,
      error: { code: 'identity.account.not-found' },
    });
    const staffRead = await persistence.unitOfWork.run(
      tenant,
      async () => ok(await portal.accounts.find(tenant, accountId)),
      { readOnly: true },
    );
    expect(staffRead).toEqual(ok(null));

    // A spent code does not sign in twice; a second code signs in to the same account.
    expect(
      await portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: first,
        method: 'email',
        address,
        code: mail.codeTo(address),
      }),
    ).toEqual({ ok: false, error: { code: 'portal.code-invalid' } });
    const second = await sentCode('email', address);
    const again = await portal.verify.execute(anonymous(), {
      clientAddress: client(),
      challengeId: second,
      method: 'email',
      address,
      code: mail.codeTo(address),
    });
    expect(again.ok && again.value.accountId).toBe(accountId);

    await portal.signOut.execute(signedIn, undefined);
    expect((await portal.authenticator.authenticate(tenant, token, 'portal-user')).ok).toBe(false);
  });

  it('reads a national mobile number with the tenant calling code and texts the code', async () => {
    await openPortal();
    const national = mobile.national();
    const id = await sentCode('mobile', national);
    const digits = national
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\D/g, '')
      .slice(1);
    const relayed = `sms+${mobile.code}${digits}@sms.invalid`;
    const signedIn = await portal.verify.execute(anonymous(), {
      clientAddress: client(),
      challengeId: id,
      method: 'mobile',
      address: `+${mobile.code}${digits}`,
      code: mail.codeTo(relayed),
    });
    expect(signedIn.ok).toBe(true);
  });

  it('counts every one of concurrent wrong answers', async () => {
    await openPortal();
    const address = email();
    const id = await sentCode('email', address);
    const right = mail.codeTo(address);
    const wrong = right === '000000' ? '000001' : '000000';
    // Each answer from its own network, so only the code's row is contended.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        portal.verify.execute(anonymous(), {
          clientAddress: `192.0.2${index}.${Math.floor(Math.random() * 250) + 1}`,
          challengeId: id,
          method: 'email',
          address,
          code: wrong,
        }),
      ),
    );
    expect(results).toEqual(
      Array.from({ length: 5 }, () => ({ ok: false, error: { code: 'portal.code-invalid' } })),
    );
    const [row] = await sql<{ failures: number; spent_at: Date | null }>(
      tenant,
      'SELECT failures, spent_at FROM identity.portal_code WHERE id = $1',
      [id],
    );
    expect(row!.failures).toBe(5);
    expect(row!.spent_at).not.toBeNull();
  });

  it('lets no one lock an address out by answering for it, and limits answers per network', async () => {
    await openPortal();
    const victim = email();
    const attacker = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      expect(
        await portal.verify.execute(anonymous(), {
          clientAddress: attacker,
          challengeId: ids.next<'PortalCode'>(),
          method: 'email',
          address: victim,
          code: '123456',
        }),
      ).toEqual({ ok: false, error: { code: 'portal.code-invalid' } });
    }
    const limited = await portal.verify.execute(anonymous(), {
      clientAddress: attacker,
      challengeId: ids.next<'PortalCode'>(),
      method: 'email',
      address: victim,
      code: '123456',
    });
    expect(limited.ok ? null : limited.error.code).toBe('rate-limit.exceeded');

    const id = await sentCode('email', victim);
    const signedIn = await portal.verify.execute(anonymous(), {
      clientAddress: client(),
      challengeId: id,
      method: 'email',
      address: victim,
      code: mail.codeTo(victim),
    });
    expect(signedIn.ok).toBe(true);
  });

  it('spends a code at the fifth wrong answer, and refuses an expired one', async () => {
    await openPortal();
    const address = email();
    const id = await sentCode('email', address);
    const right = mail.codeTo(address);
    const wrong = right === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: id,
        method: 'email',
        address,
        code: wrong,
      });
    }
    const [row] = await sql<{ failures: number; spent_at: Date | null }>(
      tenant,
      'SELECT failures, spent_at FROM identity.portal_code WHERE id = $1',
      [id],
    );
    expect(row!.failures).toBe(5);
    expect(row!.spent_at).not.toBeNull();
    expect(
      await portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: id,
        method: 'email',
        address,
        code: right,
      }),
    ).toEqual({ ok: false, error: { code: 'portal.code-invalid' } });

    const late = email();
    const lateId = await sentCode('email', late);
    clock.advance(Temporal.Duration.from({ minutes: 6 }));
    try {
      expect(
        await portal.verify.execute(anonymous(), {
          clientAddress: client(),
          challengeId: lateId,
          method: 'email',
          address: late,
          code: mail.codeTo(late),
        }),
      ).toEqual({ ok: false, error: { code: 'portal.code-invalid' } });
    } finally {
      clock.advance(Temporal.Duration.from({ minutes: -6 }));
    }
  });

  it('refuses a code for another address, another tenant, a reused CAPTCHA and a disabled account', async () => {
    await openPortal();
    const address = email();
    const id = await sentCode('email', address);
    const code = mail.codeTo(address);
    expect(
      await portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: id,
        method: 'email',
        address: email(),
        code,
      }),
    ).toEqual({ ok: false, error: { code: 'portal.code-invalid' } });
    // Another tenant does not find the code (row-level security and the tenant guard).
    const elsewhere = await portal.verify.execute(anonymous(other), {
      clientAddress: client(),
      challengeId: id,
      method: 'email',
      address,
      code,
    });
    expect(elsewhere.ok).toBe(false);

    const challenge = await portal.challenge.execute(anonymous(), { clientAddress: client() });
    if (!challenge.ok) throw new Error('no challenge');
    const payload = solve(challenge.value);
    const once = await portal.request.execute(anonymous(), {
      method: 'email',
      address: email(),
      captcha: payload,
      clientAddress: client(),
    });
    expect(once.ok).toBe(true);
    expect(
      await portal.request.execute(anonymous(), {
        method: 'email',
        address: email(),
        captcha: payload,
        clientAddress: client(),
      }),
    ).toEqual({ ok: false, error: { code: 'captcha.invalid' } });

    const signedUp = await portal.verify.execute(anonymous(), {
      clientAddress: client(),
      challengeId: id,
      method: 'email',
      address,
      code,
    });
    if (!signedUp.ok) throw new Error(signedUp.error.code);
    await sql(
      tenant,
      "UPDATE identity.account SET status = 'disabled', version = version + 1 WHERE id = $1",
      [signedUp.value.accountId],
    );
    expect(
      (await portal.authenticator.authenticate(tenant, signedUp.value.sessionToken, 'portal-user'))
        .ok,
    ).toBe(false);
    const next = await sentCode('email', address);
    expect(
      await portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: next,
        method: 'email',
        address,
        code: mail.codeTo(address),
      }),
    ).toEqual({ ok: false, error: { code: 'portal.account-disabled' } });
  });

  it('limits codes per address, and answers delivery failures', async () => {
    await openPortal();
    const address = email();
    for (let sent = 0; sent < 5; sent += 1) await sentCode('email', address);
    const sixth = await sendCode('email', address);
    expect(sixth.ok ? null : sixth.error.code).toBe('rate-limit.exceeded');

    mail.down = true;
    try {
      const failed = await sendCode('email', email());
      expect(failed).toEqual({ ok: false, error: { code: 'portal.delivery-failed' } });
    } finally {
      mail.down = false;
    }
    expect(await sendCode('email', 'not-an-address')).toEqual({
      ok: false,
      error: { code: 'identity.value.invalid', field: 'address' },
    });
  });

  it('signs in once when the right answer arrives twice at once', async () => {
    await openPortal();
    const address = email();
    const id = await sentCode('email', address);
    const answer = () =>
      portal.verify.execute(anonymous(), {
        clientAddress: client(),
        challengeId: id,
        method: 'email',
        address,
        code: mail.codeTo(address),
      });
    const results = await Promise.all([answer(), answer()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      error: { code: 'portal.code-invalid' },
    });
  });

  it('refuses a method named twice in the database', async () => {
    await openPortal();
    await expect(
      sql(
        tenant,
        "UPDATE identity.portal_sign_in_settings SET methods = '{email,email}' WHERE tenant_id = $1",
        [tenant.tenantId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each([
    ['a staff account without a username', 'tenant-staff', 'local', null, null],
    ['a portal account with a username', 'portal-user', 'one-time-code', null, 'visitor'],
    ['a portal account with a subject', 'portal-user', 'one-time-code', 'kc-subject', null],
    ['a staff account signing in by code', 'tenant-staff', 'one-time-code', null, 'staff'],
    ['a portal account of the directory', 'portal-user', 'directory', 'kc-subject', null],
  ])('refuses %s in the database', async (_name, population, source, subject, username) => {
    await expect(
      sql(
        tenant,
        `INSERT INTO identity.account
           (id, tenant_id, population, source, subject, username, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', 1, $7, $7)`,
        [
          ids.next<'Account'>(),
          tenant.tenantId,
          population,
          source,
          subject,
          username,
          '2026-10-28T10:00:00Z',
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('prunes codes a day after they expired', async () => {
    await openPortal();
    const id = await sentCode('email', email());
    clock.advance(Temporal.Duration.from({ hours: 25 }));
    try {
      const pruned = await portal.prune.execute(testCallContext(tenant, 'system'), undefined);
      expect(pruned.ok && pruned.value).toBeGreaterThanOrEqual(1);
      expect(await sql(tenant, 'SELECT id FROM identity.portal_code WHERE id = $1', [id])).toEqual(
        [],
      );
    } finally {
      clock.advance(Temporal.Duration.from({ hours: -25 }));
    }
  });
});
