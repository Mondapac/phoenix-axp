import { createHash, randomUUID } from 'node:crypto';
import { encodeAuditFields, Temporal } from '@phoenix/shared-kernel';
import type { AuditEntry, CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import {
  FixedClock,
  SequenceIdGenerator,
  testAuthenticatedActor,
  testCallContext,
} from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { AuditWriter } from '../../src/platform/audit/audit-writer';
import type { ActorGrant } from '../../src/platform/authz/actor-grants';
import {
  ALL_DEFINITIONS,
  type DefinitionQualifier,
} from '../../src/platform/authz/definition-scope';
import type { FieldGrant, FieldMode } from '../../src/platform/authz/field-policy';
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import type { GrantScope } from '../../src/platform/authz/roles/role-model';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { CaptchaService, type ProofOfWorkChallenge } from '../../src/platform/captcha';
import { PrismaCaptchaSpentStore } from '../../src/platform/persistence/captcha/prisma-captcha-spent-store';
import { PrismaRateLimitStore } from '../../src/platform/persistence/rate-limit/prisma-rate-limit-store';
import { PrismaSubjectKeyStore } from '../../src/platform/persistence/subject-keys/prisma-subject-key-store';
import { PostgresRateLimiter, rateLimitKey } from '../../src/platform/rate-limit/rate-limiter';
import { SubjectKeyCipher } from '../../src/platform/subject-keys/subject-key-cipher';
import { SubjectKeyService } from '../../src/platform/subject-keys/subject-key.service';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
import { FormReach } from '../../src/modules/forms/application/form-reach';
import { SubmissionAccess } from '../../src/modules/forms/application/submission-access';
import { CreateForm } from '../../src/modules/forms/application/use-cases/create-form.use-case';
import { EraseExpiredSubmissions } from '../../src/modules/forms/application/use-cases/erase-expired-submissions.use-case';
import { EraseFormSubmission } from '../../src/modules/forms/application/use-cases/erase-form-submission.use-case';
import { IssueSubmissionChallenge } from '../../src/modules/forms/application/use-cases/issue-submission-challenge.use-case';
import { ListFormSubmissions } from '../../src/modules/forms/application/use-cases/list-form-submissions.use-case';
import { PublishForm } from '../../src/modules/forms/application/use-cases/publish-form.use-case';
import { SaveFormRevision } from '../../src/modules/forms/application/use-cases/save-form-revision.use-case';
import { SubmissionIntake } from '../../src/modules/forms/application/submission-intake';
import { SubmitFormOnBehalf } from '../../src/modules/forms/application/use-cases/submit-form-on-behalf.use-case';
import { SubmitFormSignedIn } from '../../src/modules/forms/application/use-cases/submit-form-signed-in.use-case';
import { SubmitForm } from '../../src/modules/forms/application/use-cases/submit-form.use-case';
import { TrackSubmission } from '../../src/modules/forms/application/use-cases/track-submission.use-case';
import { ViewFormSubmission } from '../../src/modules/forms/application/use-cases/view-form-submission.use-case';
import { ViewPublishedFormSignedIn } from '../../src/modules/forms/application/use-cases/view-published-form-signed-in.use-case';
import { ViewPublishedForm } from '../../src/modules/forms/application/use-cases/view-published-form.use-case';
import {
  FORMS_PERMISSIONS,
  FORMS_SUBMISSION_ERASE,
  FORMS_SUBMISSION_READ,
  FORMS_SUBMISSION_SUBMIT_ON_BEHALF,
} from '../../src/modules/forms/contracts/permissions';
import { FORMS_AUDIT_ACTIONS } from '../../src/modules/forms/domain/audit-actions';
import type { SubmissionPolicy } from '../../src/modules/forms/domain/form-settings';
import { PrismaFormRepository } from '../../src/modules/forms/infrastructure/prisma-form.repository';
import { PrismaSubmissionRepository } from '../../src/modules/forms/infrastructure/prisma-submission.repository';
import { WorkerSchemaEngine } from '../../src/modules/forms/infrastructure/worker-schema-engine';
import { CreateSite } from '../../src/modules/tenancy/application/use-cases/create-site.use-case';
import { TENANCY_PERMISSIONS } from '../../src/modules/tenancy/contracts/permissions';
import { PrismaOrganizationRepository } from '../../src/modules/tenancy/infrastructure/prisma-organization.repository';
import { FORMS_EVENTS } from '../../src/modules/forms/domain/events';
import { PrismaSiteRepository } from '../../src/modules/tenancy/infrastructure/prisma-site.repository';
import { PrismaTenantSettingsRepository } from '../../src/modules/tenancy/infrastructure/prisma-tenant-settings.repository';
import { ClosureSiteAncestryReader } from '../../src/modules/tenancy/infrastructure/site-ancestry.reader';
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
import { moduleWriter } from './outbox-support';
import { testDatabaseUrl } from './test-database';

// Phase 2 slice 2.5: form submissions end to end against PostgreSQL, on both tenant fixtures:
// the snapshot of the revision and its hash (ADR-0007 V3), the answers sealed under the
// submission's own subject key, the proof-of-work CAPTCHA, the rate limit, the tracking code,
// submitting on behalf of someone, the form inbox under field-level access (ADR-0024: a hidden
// field is absent from every read), erasure on request and by retention, and the row-level
// security and grants of the new tables. Grants and field rules come from an in-test reader per
// staff member, as identity's readers answer them; everything else is the real thing.

const DEFINITIONS = new Map(FORMS_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(_context: CallContext, entry: AuditEntry): Promise<void> {
    if (entry.action.startsWith('tenancy.')) return Promise.resolve();
    const definition = DEFINITIONS.get(entry.action);
    if (definition === undefined) throw new Error(`undeclared audit action ${entry.action}`);
    const options = { isKnownPermissionKey: () => false };
    for (const [fields, values] of [
      [definition.before, entry.before],
      [definition.after, entry.after],
    ] as const) {
      if (fields === null) expect(values).toBeNull();
      else expect(encodeAuditFields(fields, values, options).ok).toBe(true);
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
  of(targetId: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.targetId === targetId);
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

const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;
const address = (): string => `198.51.100.${Math.floor(Math.random() * 250) + 1}-${randomUUID()}`;

const jsonSchema = {
  type: 'object',
  required: ['fullName'],
  properties: {
    fullName: { type: 'string', minLength: 2 },
    nationalId: { type: 'string', pattern: '^[0-9]{10}$' },
    note: { type: 'string', maxLength: 200 },
  },
};
const uiSchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/fullName' },
    { type: 'Control', scope: '#/properties/nationalId' },
    { type: 'Control', scope: '#/properties/note' },
  ],
};
/** The designer opens the name and the note; the national id stays sensitive (the default). */
const fieldSettings = { fullName: { sensitive: false }, note: { sensitive: false } };
const answers = { fullName: 'زهرا رضایی', nationalId: '0012345678', note: 'ملاقات صبح' };
const anyone: SubmissionPolicy = { audience: 'anyone', roleIds: [], allowOnBehalf: false };

describe.each(TEST_TENANTS)('form submissions in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-28T09:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  const engine = new WorkerSchemaEngine();
  let persistence: Persistence;
  let app: Client;

  /** Runs `sql` as the application login in `of`, then rolls back. */
  async function asApplication<R extends object>(
    sql: string,
    params: unknown[],
    of: TenantContext = tenant,
  ): Promise<R[]> {
    await app.query('BEGIN');
    try {
      await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [of.tenantId]);
      return (await app.query<R>(sql, params)).rows;
    } finally {
      await app.query('ROLLBACK');
    }
  }

  // The grants of each staff member, by account, as identity's readers would answer them.
  const grantsByAccount = new Map<string, FieldGrant[]>();
  const accountOf = (context: CallContext): string | null =>
    context.actor.kind === 'authenticated' ? context.actor.accountId : null;
  const fieldRules = {
    grantsFor: (context: CallContext) =>
      Promise.resolve(grantsByAccount.get(accountOf(context) ?? '') ?? []),
  };
  const actorGrants = {
    grantsOf: (context: CallContext): Promise<readonly ActorGrant[]> =>
      Promise.resolve(
        (grantsByAccount.get(accountOf(context) ?? '') ?? []).map((grant) => ({
          roleId: ids.next<'Role'>(),
          scope: grant.scope,
          keys: grant.keys,
        })),
      ),
  };

  const staffOf = (of: TenantContext): CallContext =>
    testCallContext(
      of,
      testAuthenticatedActor(of, {
        population: 'tenant-staff',
        accountId: ids.next<'Account'>(),
        sessionId: ids.next<'Session'>(),
      }),
    );
  /** A staff member holding `keys` under one grant of `scope`, for `definitions`. */
  function staffWith(
    keys: readonly string[],
    options: {
      readonly scope?: GrantScope;
      readonly definitions?: DefinitionQualifier;
      readonly rules?: Readonly<Record<string, FieldMode>>;
    } = {},
  ): CallContext {
    const context = staffOf(tenant);
    const qualifier = options.definitions ?? ALL_DEFINITIONS;
    grantsByAccount.set(accountOf(context)!, [
      {
        scope: options.scope ?? { level: 'tenant' },
        keys: new Set(keys),
        qualifiers: new Map(keys.map((key) => [key, qualifier])),
        fieldRules: new Map(
          Object.entries(options.rules ?? {}).map(([id, mode]) => [id as Id<'Field'>, mode]),
        ),
      },
    ]);
    return context;
  }
  const designer = staffWith(FORMS_PERMISSIONS.declarations.map((d) => d.key));
  const anonymous = testCallContext(tenant, 'anonymous');
  const system = testCallContext(tenant, 'system');

  let useCases: ReturnType<typeof build>;
  function build(p: Persistence, jobClock: FixedClock) {
    const declared = new Map<string, PermissionDeclaration>(
      [...FORMS_PERMISSIONS.declarations, ...TENANCY_PERMISSIONS.declarations].map((d) => [
        d.key,
        d,
      ]),
    );
    const tenants = new TenantRegistry(
      loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANTS.map(testTenantId)),
    );
    const gate = createUseCaseGate(
      tenants,
      { get: (key) => declared.get(key) },
      { check: () => Promise.resolve({ allowed: true }) },
    );
    const uow = p.unitOfWork;
    const sites = new PrismaSiteRepository(p.service);
    const forms = new PrismaFormRepository(p.service);
    const submissions = new PrismaSubmissionRepository(p.service);
    const ancestry = new ClosureSiteAncestryReader(uow, sites);
    const reach = new FormReach(uow, forms, actorGrants, ancestry);
    const access = new SubmissionAccess(fieldRules, ancestry);
    const secret = Buffer.from('test-only-session-secret-of-the-db-spec');
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
    const intake = new SubmissionIntake(
      uow,
      forms,
      submissions,
      engine,
      limiter,
      subjectKeys,
      audit,
      moduleWriter(p, 'forms', FORMS_EVENTS),
      clock,
      ids,
    );
    return {
      subjectKeys,
      createSite: new CreateSite(
        gate,
        uow,
        new PrismaTenantSettingsRepository(p.service),
        sites,
        new PrismaOrganizationRepository(p.service),
        audit,
        clock,
        ids,
      ),
      createForm: new CreateForm(gate, uow, forms, reach, ancestry, audit, clock, ids),
      saveRevision: new SaveFormRevision(gate, uow, forms, reach, engine, audit, clock, ids),
      publishForm: new PublishForm(gate, uow, forms, reach, engine, audit, clock),
      viewPublished: new ViewPublishedForm(gate, intake, actorGrants),
      viewPublishedSignedIn: new ViewPublishedFormSignedIn(gate, intake, actorGrants),
      challenge: new IssueSubmissionChallenge(gate, captcha, limiter),
      submit: new SubmitForm(gate, intake, captcha),
      submitSignedIn: new SubmitFormSignedIn(gate, intake, actorGrants),
      submitOnBehalf: new SubmitFormOnBehalf(gate, intake, access),
      track: new TrackSubmission(gate, uow, forms, submissions, limiter),
      inbox: new ListFormSubmissions(gate, uow, forms, submissions, access, subjectKeys),
      view: new ViewFormSubmission(gate, uow, forms, submissions, access, subjectKeys),
      erase: new EraseFormSubmission(
        gate,
        uow,
        submissions,
        fieldRules,
        ancestry,
        subjectKeys,
        audit,
        clock,
      ),
      eraseExpired: new EraseExpiredSubmissions(
        gate,
        uow,
        submissions,
        subjectKeys,
        audit,
        jobClock,
      ),
    };
  }
  const later = new FixedClock(clock.now());

  beforeAll(async () => {
    persistence = createPersistence();
    app = new Client({ connectionString: testDatabaseUrl() });
    await app.connect();
    useCases = build(persistence, later);
  });

  afterAll(async () => {
    engine.onApplicationShutdown();
    await app.end();
    await persistence.close();
  });

  async function newSite(of: CallContext = designer): Promise<Id<'Site'>> {
    const created = await useCases.createSite.execute(of, {
      parentSiteId: null,
      organizationId: null,
      slug: unique('s'),
      name: 'سایت',
    });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    return created.value.id;
  }

  interface Published {
    readonly formId: Id<'Form'>;
    readonly siteId: Id<'Site'>;
    readonly key: string;
    readonly revisionId: Id<'FormRevision'>;
    readonly contentHash: string;
    readonly fieldId: Readonly<Record<keyof typeof answers, Id<'Field'>>>;
  }

  /** A published form of `policy` on a new site, with the three fields above. */
  async function published(
    policy: SubmissionPolicy = anyone,
    retention?: { kind: 'fixed'; days: number },
  ): Promise<Published> {
    const siteId = await newSite();
    const key = unique('visit');
    const created = await useCases.createForm.execute(designer, {
      siteId,
      key,
      name: 'درخواست ملاقات',
      policy,
      ...(retention === undefined ? {} : { retention }),
    });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    const formId = created.value.id;
    const saved = await useCases.saveRevision.execute(designer, {
      formId,
      jsonSchema,
      uiSchema,
      fields: fieldSettings,
    });
    if (!saved.ok) throw new Error(`setup: ${saved.error.code}`);
    const done = await useCases.publishForm.execute(designer, {
      formId,
      version: 1,
      revisionId: saved.value.id,
    });
    if (!done.ok) throw new Error(`setup: ${done.error.code}`);
    const byName = new Map(saved.value.fields.map((field) => [field.name, field.id]));
    return {
      formId,
      siteId,
      key,
      revisionId: saved.value.id,
      contentHash: saved.value.contentHash,
      fieldId: {
        fullName: byName.get('fullName')!,
        nationalId: byName.get('nationalId')!,
        note: byName.get('note')!,
      },
    };
  }

  /** An anonymous submission with a solved challenge. */
  async function submitAnonymously(form: Published, values: object = answers) {
    const client = address();
    const issued = await useCases.challenge.execute(anonymous, { clientAddress: client });
    if (!issued.ok) throw new Error(`setup: ${issued.error.code}`);
    const submitted = await useCases.submit.execute(anonymous, {
      formKey: form.key,
      answers: values,
      captcha: solve(issued.value),
      clientAddress: client,
    });
    if (!submitted.ok) throw new Error(`setup: ${submitted.error.code}`);
    return submitted.value;
  }

  it('takes an anonymous submission with a solved challenge, keeping the revision and its hash (V3)', async () => {
    const form = await published();
    const page = await useCases.viewPublished.execute(anonymous, { formKey: form.key });
    expect(page).toEqual({
      ok: true,
      value: {
        name: 'درخواست ملاقات',
        revisionId: form.revisionId,
        jsonSchema,
        uiSchema,
        captchaRequired: true,
        onBehalfOffered: false,
      },
    });
    const done = await submitAnonymously(form);
    expect(done.trackingCode).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}$/);
    const [row] = await asApplication<{
      revision_id: string;
      revision_hash: string;
      site_id: string;
      channel: string;
      submitted_by: string | null;
      erase_after: Date | null;
      tracking_code_hash: string;
    }>(
      `SELECT revision_id, revision_hash, site_id, channel, submitted_by, erase_after,
              tracking_code_hash FROM forms.form_submission WHERE id = $1`,
      [done.submissionId],
    );
    expect(row).toEqual({
      revision_id: form.revisionId,
      revision_hash: form.contentHash,
      site_id: form.siteId,
      channel: 'anonymous',
      submitted_by: null,
      // D5: no retention set, kept until erased on request.
      erase_after: null,
      // Only the code's hash is stored.
      tracking_code_hash: createHash('sha256')
        .update(done.trackingCode.replace(/-/g, ''))
        .digest('hex'),
    });
    expect(audit.of(done.submissionId)).toEqual([
      expect.objectContaining({
        action: 'forms.submission.received',
        after: {
          formId: form.formId,
          revisionId: form.revisionId,
          channel: 'anonymous',
          boundSubjectId: done.submissionId,
        },
      }),
    ]);
    // Slice 2.6: the submission's event, in its unit, with ids and the channel only.
    const events = await asApplication<{
      type: string;
      aggregate_type: string;
      aggregate_version: number;
      payload: unknown;
    }>(
      `SELECT type, aggregate_type, aggregate_version, payload FROM forms.outbox
        WHERE aggregate_id = $1`,
      [done.submissionId],
    );
    expect(events).toEqual([
      {
        type: 'forms.submission-received.v1',
        aggregate_type: 'form-submission',
        aggregate_version: 1,
        payload: {
          formId: form.formId,
          revisionId: form.revisionId,
          siteId: form.siteId,
          channel: 'anonymous',
        },
      },
    ]);
  });

  it('stores the answers sealed under the submission own subject key, never in clear', async () => {
    const form = await published();
    const done = await submitAnonymously(form);
    const [stored] = await asApplication<{ plain: number; national: number; bytes: number }>(
      `SELECT position(convert_to($2, 'UTF8') IN data) AS plain,
              position(convert_to($3, 'UTF8') IN data) AS national,
              octet_length(data) AS bytes
         FROM forms.form_submission WHERE id = $1`,
      [done.submissionId, answers.fullName, answers.nationalId],
    );
    expect(stored).toMatchObject({ plain: 0, national: 0 });
    const [key] = await asApplication<{ module: string; bytes: number; destroyed: boolean }>(
      `SELECT module, octet_length(wrapped_key) AS bytes, destroyed_at IS NOT NULL AS destroyed
         FROM platform.subject_key WHERE subject_id = $1`,
      [done.submissionId],
    );
    expect(key).toEqual({ module: 'forms', bytes: 61, destroyed: false });
  });

  it('refuses a missing, forged or spent challenge, and answers that break the schema', async () => {
    const form = await published();
    const client = address();
    const submit = (captcha: string | undefined, values: unknown = answers) =>
      useCases.submit.execute(anonymous, {
        formKey: form.key,
        answers: values,
        clientAddress: client,
        ...(captcha === undefined ? {} : { captcha }),
      });
    const invalid = { ok: false, error: { code: 'captcha.invalid' } };
    expect(await submit(undefined)).toEqual(invalid);
    expect(await submit(Buffer.from('{"number":1}').toString('base64'))).toEqual(invalid);
    const issued = await useCases.challenge.execute(anonymous, { clientAddress: client });
    if (!issued.ok) throw new Error('setup');
    const payload = solve(issued.value);
    // The other tenant's signature does not hold here.
    const theirs = await useCases.challenge.execute(testCallContext(other, 'anonymous'), {
      clientAddress: client,
    });
    if (!theirs.ok) throw new Error('setup');
    expect(await submit(solve(theirs.value))).toEqual(invalid);

    expect(await submit(payload)).toMatchObject({ ok: true });
    expect(await submit(payload)).toEqual(invalid);

    const fresh = await useCases.challenge.execute(anonymous, { clientAddress: client });
    if (!fresh.ok) throw new Error('setup');
    expect(await submit(solve(fresh.value), { ...answers, nationalId: '12' })).toEqual({
      ok: false,
      error: {
        code: 'forms.submission.invalid',
        problems: [{ pointer: '/nationalId', keyword: 'pattern' }],
      },
    });
    expect(await submit(solve(fresh.value), { ...answers, extra: 'x' })).toEqual({
      ok: false,
      error: {
        code: 'forms.submission.invalid',
        problems: [{ pointer: '/extra', keyword: 'additionalProperties' }],
      },
    });
  });

  it('limits submissions per client address, before anything else is checked', async () => {
    const form = await published();
    const client = address();
    const results = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      results.push(
        await useCases.submit.execute(anonymous, {
          formKey: form.key,
          answers,
          clientAddress: client,
        }),
      );
    }
    expect(results.slice(0, 10).every((r) => !r.ok && r.error.code === 'captcha.invalid')).toBe(
      true,
    );
    expect(results[10]).toEqual({
      ok: false,
      error: { code: 'rate-limit.exceeded', retryAfterSeconds: expect.any(Number) as unknown },
    });
    // Another address is not limited.
    expect(
      await useCases.submit.execute(anonymous, {
        formKey: form.key,
        answers,
        clientAddress: address(),
      }),
    ).toEqual({ ok: false, error: { code: 'captcha.invalid' } });
  });

  it('serves a form only to the people its policy admits, as not found to anyone else', async () => {
    const staffOnly = await published({ audience: 'staff', roleIds: [], allowOnBehalf: false });
    const notFound = { ok: false, error: { code: 'forms.form.not-found' } };
    expect(await useCases.viewPublished.execute(anonymous, { formKey: staffOnly.key })).toEqual(
      notFound,
    );
    expect(
      await useCases.submit.execute(anonymous, {
        formKey: staffOnly.key,
        answers,
        clientAddress: address(),
      }),
    ).toEqual(notFound);
    const member = staffWith([]);
    expect(
      await useCases.viewPublishedSignedIn.execute(member, { formKey: staffOnly.key }),
    ).toMatchObject({ ok: true, value: { captchaRequired: false, onBehalfOffered: false } });
    const done = await useCases.submitSignedIn.execute(member, {
      formKey: staffOnly.key,
      answers: { fullName: 'کارمند' },
      clientAddress: address(),
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const [row] = await asApplication<{ channel: string; submitted_by: string }>(
      'SELECT channel, submitted_by FROM forms.form_submission WHERE id = $1',
      [done.value.submissionId],
    );
    expect(row).toEqual({ channel: 'staff', submitted_by: accountOf(member) });

    const portal = testCallContext(
      tenant,
      testAuthenticatedActor(tenant, {
        population: 'portal-user',
        accountId: ids.next<'Account'>(),
        sessionId: ids.next<'Session'>(),
      }),
    );
    expect(
      await useCases.viewPublishedSignedIn.execute(portal, { formKey: staffOnly.key }),
    ).toEqual(notFound);
    expect(
      await useCases.submitSignedIn.execute(portal, {
        formKey: staffOnly.key,
        answers: { fullName: 'کاربر' },
        clientAddress: address(),
      }),
    ).toEqual(notFound);
    // The other tenant has no form of that key.
    expect(
      await useCases.viewPublished.execute(testCallContext(other, 'anonymous'), {
        formKey: staffOnly.key,
      }),
    ).toEqual(notFound);
  });

  it('tracks a submission by its code alone, in Persian digits too, showing no personal data', async () => {
    const form = await published();
    const done = await submitAnonymously(form);
    const expected = {
      ok: true,
      value: {
        form: { name: 'درخواست ملاقات' },
        status: 'received',
        submittedAt: done.submittedAt,
      },
    };
    const track = (trackingCode: string, of: CallContext = anonymous) =>
      useCases.track.execute(of, { trackingCode, clientAddress: address() });
    expect(await track(done.trackingCode)).toEqual(expected);
    const persian = done.trackingCode.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
    expect(await track(persian)).toEqual(expected);
    const notFound = { ok: false, error: { code: 'forms.submission.not-found' } };
    expect(await track('0000-0000-0000-0000')).toEqual(notFound);
    expect(await track('not a code')).toEqual(notFound);
    expect(await track(done.trackingCode, testCallContext(other, 'anonymous'))).toEqual(notFound);
  });

  it('shows the inbox through field-level access: a hidden field is absent (ADR-0024)', async () => {
    const form = await published();
    const done = await submitAnonymously(form);
    const { fullName, nationalId, note } = form.fieldId;
    const page = async (reader: CallContext) => {
      const listed = await useCases.inbox.execute(reader, {
        formId: form.formId,
        after: null,
        limit: 10,
      });
      if (!listed.ok) return listed;
      return {
        ok: true,
        answers: listed.value.items.map((item) => item.answers),
        fields: listed.value.fields.map((field) => field.id).sort(),
      };
    };

    // No rule: the read grant shows the open fields; the sensitive national id stays hidden.
    const reader = staffWith([FORMS_SUBMISSION_READ.key]);
    expect(await page(reader)).toEqual({
      ok: true,
      answers: [{ [fullName]: answers.fullName, [note]: answers.note }],
      fields: [fullName, note].sort(),
    });
    // A rule opens the sensitive field; another hides an open one, from answers and fields.
    const ruled = staffWith([FORMS_SUBMISSION_READ.key], {
      rules: { [nationalId]: 'read', [note]: 'hidden' },
    });
    expect(await page(ruled)).toEqual({
      ok: true,
      answers: [{ [fullName]: answers.fullName, [nationalId]: answers.nationalId }],
      fields: [fullName, nationalId].sort(),
    });
    const viewed = await useCases.view.execute(ruled, { submissionId: done.submissionId });
    expect(viewed.ok && viewed.value.submission.answers).toEqual({
      [fullName]: answers.fullName,
      [nationalId]: answers.nationalId,
    });
    expect(viewed.ok && Object.keys(viewed.value.submission)).not.toContain('submittedBy');

    // Outside the reader's definition, site or tenant: as if the form did not exist.
    const formNotFound = { ok: false, error: { code: 'forms.form.not-found' } };
    const submissionNotFound = { ok: false, error: { code: 'forms.submission.not-found' } };
    const elsewhere = [
      staffWith([FORMS_SUBMISSION_READ.key], {
        definitions: { all: false, definitionIds: new Set([ids.next<'Definition'>()]) },
      }),
      staffWith([FORMS_SUBMISSION_READ.key], {
        scope: { level: 'site', siteId: await newSite(), includeDescendants: true },
      }),
      staffWith([FORMS_SUBMISSION_ERASE.key]),
    ];
    for (const outsider of elsewhere) {
      expect(await page(outsider)).toEqual(formNotFound);
      expect(await useCases.view.execute(outsider, { submissionId: done.submissionId })).toEqual(
        submissionNotFound,
      );
    }
    const theirs = staffOf(other);
    grantsByAccount.set(accountOf(theirs)!, grantsByAccount.get(accountOf(reader)!)!);
    expect(await page(theirs)).toEqual(formNotFound);
    expect(await useCases.view.execute(theirs, { submissionId: done.submissionId })).toEqual(
      submissionNotFound,
    );
  });

  it('never shows a field that only a submit-on-behalf grant opens (security review H1)', async () => {
    const form = await published({ audience: 'anyone', roleIds: [], allowOnBehalf: true });
    const done = await submitAnonymously(form);
    const { fullName, nationalId, note } = form.fieldId;
    // One staff member, two roles: reading the inbox, and typing the national id in for people.
    const both = staffWith([FORMS_SUBMISSION_READ.key]);
    grantsByAccount.get(accountOf(both)!)!.push({
      scope: { level: 'tenant' },
      keys: new Set([FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key]),
      qualifiers: new Map([[FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key, ALL_DEFINITIONS]]),
      fieldRules: new Map([[nationalId, 'edit']]),
    });
    const listed = await useCases.inbox.execute(both, {
      formId: form.formId,
      after: null,
      limit: 10,
    });
    expect(listed.ok && listed.value.items.map((item) => item.answers)).toEqual([
      { [fullName]: answers.fullName, [note]: answers.note },
    ]);
    expect(listed.ok && listed.value.fields.map((field) => field.id)).not.toContain(nationalId);
    const viewed = await useCases.view.execute(both, { submissionId: done.submissionId });
    expect(viewed.ok && Object.keys(viewed.value.submission.answers)).not.toContain(nationalId);
    // The on-behalf grant still lets them write it.
    expect(
      (
        await useCases.submitOnBehalf.execute(both, {
          formKey: form.key,
          answers,
          clientAddress: address(),
        })
      ).ok,
    ).toBe(true);
  });

  it('pages the inbox newest first with a cursor', async () => {
    const form = await published();
    const made = [];
    for (let n = 0; n < 3; n += 1) {
      clock.advance(Temporal.Duration.from({ seconds: 1 }));
      made.push((await submitAnonymously(form)).submissionId);
    }
    const reader = staffWith([FORMS_SUBMISSION_READ.key]);
    const first = await useCases.inbox.execute(reader, {
      formId: form.formId,
      after: null,
      limit: 2,
    });
    expect(first.ok && first.value.items.map((item) => item.id)).toEqual([made[2], made[1]]);
    const next = first.ok ? first.value.next : null;
    expect(next).not.toBeNull();
    const second = await useCases.inbox.execute(reader, {
      formId: form.formId,
      after: next,
      limit: 2,
    });
    expect(second.ok && second.value.items.map((item) => item.id)).toEqual([made[0]]);
    expect(second.ok && second.value.next).toBeNull();
  });

  it('submits on behalf of someone only with the grant, and never into a field not editable', async () => {
    const form = await published({ audience: 'anyone', roleIds: [], allowOnBehalf: true });
    const { nationalId } = form.fieldId;
    const onBehalf = (actor: CallContext, values: object = answers) =>
      useCases.submitOnBehalf.execute(actor, {
        formKey: form.key,
        answers: values,
        clientAddress: address(),
      });
    const notFound = { ok: false, error: { code: 'forms.form.not-found' } };
    expect(
      await useCases.viewPublishedSignedIn.execute(
        staffWith([FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key]),
        { formKey: form.key },
      ),
    ).toMatchObject({ ok: true, value: { onBehalfOffered: true } });
    expect(await onBehalf(staffWith([FORMS_SUBMISSION_READ.key]))).toEqual(notFound);
    expect(
      await onBehalf(
        staffWith([FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key], {
          scope: { level: 'site', siteId: await newSite(), includeDescendants: false },
        }),
      ),
    ).toEqual(notFound);

    // The sensitive field is hidden until a rule opens it: a payload naming it is refused.
    const clerk = staffWith([FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key], {
      scope: { level: 'site', siteId: form.siteId, includeDescendants: false },
    });
    expect(await onBehalf(clerk)).toEqual({ ok: false, error: { code: 'access.field-denied' } });
    const done = await onBehalf(clerk, { fullName: answers.fullName });
    expect(done.ok).toBe(true);

    const trusted = staffWith([FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key], {
      rules: { [nationalId]: 'edit' },
    });
    const full = await onBehalf(trusted);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const [row] = await asApplication<{ channel: string; submitted_by: string }>(
      'SELECT channel, submitted_by FROM forms.form_submission WHERE id = $1',
      [full.value.submissionId],
    );
    // Both people are on record: the staff member here, the submission (its subject) in audit.
    expect(row).toEqual({ channel: 'on-behalf', submitted_by: accountOf(trusted) });
    expect(audit.of(full.value.submissionId).at(-1)).toMatchObject({
      after: { channel: 'on-behalf', boundSubjectId: full.value.submissionId },
    });

    // A form that does not allow it is not offered and refuses it.
    const closed = await published();
    expect(
      await useCases.submitOnBehalf.execute(trusted, {
        formKey: closed.key,
        answers,
        clientAddress: address(),
      }),
    ).toEqual(notFound);
  });

  it('erases the personal data on request by destroying its key; the tracking page remains', async () => {
    const form = await published();
    const done = await submitAnonymously(form);
    const eraser = staffWith([FORMS_SUBMISSION_ERASE.key]);
    const reader = staffWith([FORMS_SUBMISSION_READ.key]);
    expect(
      await useCases.erase.execute(staffWith([FORMS_SUBMISSION_READ.key]), {
        submissionId: done.submissionId,
        version: 1,
      }),
    ).toEqual({ ok: false, error: { code: 'forms.submission.not-found' } });
    await expect(
      useCases.erase.execute(eraser, { submissionId: done.submissionId, version: 7 }),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    expect(
      await useCases.erase.execute(eraser, { submissionId: done.submissionId, version: 1 }),
    ).toEqual({ ok: true, value: undefined });
    const viewed = await useCases.view.execute(reader, { submissionId: done.submissionId });
    expect(viewed.ok && viewed.value.submission).toMatchObject({ erased: true, answers: {} });
    const [key] = await asApplication<{ wrapped: boolean; destroyed: boolean }>(
      `SELECT wrapped_key IS NOT NULL AS wrapped, destroyed_at IS NOT NULL AS destroyed
         FROM platform.subject_key WHERE subject_id = $1`,
      [done.submissionId],
    );
    expect(key).toEqual({ wrapped: false, destroyed: true });
    // Erasure is final: not even the application role can bring the key back.
    await expect(
      asApplication(
        `UPDATE platform.subject_key SET destroyed_at = NULL, wrapped_key = decode(repeat('00', 61), 'hex')
          WHERE subject_id = $1`,
        [done.submissionId],
      ),
    ).rejects.toMatchObject({ code: '23001' });
    expect(audit.of(done.submissionId).at(-1)).toMatchObject({
      action: 'forms.submission.erased',
      after: { formId: form.formId, reason: 'request' },
    });
    expect(
      await useCases.erase.execute(eraser, { submissionId: done.submissionId, version: 2 }),
    ).toEqual({ ok: false, error: { code: 'forms.submission.already-erased' } });
    expect(
      (
        await useCases.track.execute(anonymous, {
          trackingCode: done.trackingCode,
          clientAddress: address(),
        })
      ).ok,
    ).toBe(true);
  });

  it('erases by retention once the fixed period has ended, once, even when two runs race (D5)', async () => {
    const form = await published(anyone, { kind: 'fixed', days: 1 });
    const done = await submitAnonymously(form);
    const [row] = await asApplication<{ erase_after: Date }>(
      'SELECT erase_after FROM forms.form_submission WHERE id = $1',
      [done.submissionId],
    );
    expect(row!.erase_after.getTime()).toBe(done.submittedAt.add({ hours: 24 }).epochMilliseconds);

    later.set(done.submittedAt.add({ hours: 23 }));
    await useCases.eraseExpired.execute(system, undefined);
    expect(audit.of(done.submissionId).map((entry) => entry.action)).toEqual([
      'forms.submission.received',
    ]);

    later.set(done.submittedAt.add({ hours: 24 }));
    const runs = await Promise.all([
      useCases.eraseExpired.execute(system, undefined),
      useCases.eraseExpired.execute(system, undefined),
    ]);
    expect(runs.every((run) => run.ok)).toBe(true);
    expect(audit.of(done.submissionId).map((entry) => entry.action)).toEqual([
      'forms.submission.received',
      'forms.submission.erased',
    ]);
    expect(audit.of(done.submissionId).at(-1)).toMatchObject({ after: { reason: 'retention' } });
    const [key] = await asApplication<{ destroyed: boolean }>(
      'SELECT destroyed_at IS NOT NULL AS destroyed FROM platform.subject_key WHERE subject_id = $1',
      [done.submissionId],
    );
    expect(key).toEqual({ destroyed: true });
  });

  it('refuses to publish or serve a revision saved before field ids existed', async () => {
    const siteId = await newSite();
    const key = unique('old');
    const created = await useCases.createForm.execute(designer, {
      siteId,
      key,
      name: 'قدیمی',
      policy: anyone,
    });
    if (!created.ok) throw new Error('setup');
    const revisionId = ids.next<'FormRevision'>();
    // As 2.4 saved it: no fields.
    await app.query('BEGIN');
    await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
    await app.query(
      `INSERT INTO forms.form_revision (id, tenant_id, form_id, number, json_schema, ui_schema,
         content_hash, created_at) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [
        revisionId,
        tenant.tenantId,
        created.value.id,
        jsonSchema,
        uiSchema,
        `sha256:${'0'.repeat(64)}`,
        new Date(clock.now().epochMilliseconds),
      ],
    );
    await app.query('COMMIT');
    expect(
      await useCases.publishForm.execute(designer, {
        formId: created.value.id,
        version: 1,
        revisionId,
      }),
    ).toEqual({ ok: false, error: { code: 'forms.form-revision.outdated' } });
  });

  it('keeps submissions and subject keys in their tenant, and their history unchangeable', async () => {
    const form = await published();
    const done = await submitAnonymously(form);
    const count = (sql: string, of: TenantContext) =>
      asApplication<{ n: string }>(sql, [done.submissionId], of);
    for (const sql of [
      'SELECT count(*) AS n FROM forms.form_submission WHERE id = $1',
      'SELECT count(*) AS n FROM platform.subject_key WHERE subject_id = $1',
    ]) {
      expect(await count(sql, tenant)).toEqual([{ n: '1' }]);
      expect(await count(sql, other)).toEqual([{ n: '0' }]);
    }
    expect(
      await asApplication<{ n: string }>(
        'SELECT count(*) AS n FROM platform.rate_limit_window WHERE tenant_id = $1',
        [tenant.tenantId],
        other,
      ),
    ).toEqual([{ n: '0' }]);
    expect(
      await asApplication<{ n: string }>(
        'SELECT count(*) AS n FROM platform.captcha_spent WHERE tenant_id = $1',
        [tenant.tenantId],
        other,
      ),
    ).toEqual([{ n: '0' }]);

    // The application role cannot rewrite or delete what was submitted, or move a key.
    for (const sql of [
      `UPDATE forms.form_submission SET data = '\\x00' WHERE id = $1`,
      `UPDATE forms.form_submission SET revision_id = id WHERE id = $1`,
      'DELETE FROM forms.form_submission WHERE id = $1',
      `UPDATE platform.subject_key SET subject_id = gen_random_uuid() WHERE subject_id = $1`,
      'DELETE FROM platform.subject_key WHERE subject_id = $1',
    ]) {
      await expect(asApplication(sql, [done.submissionId])).rejects.toMatchObject({
        code: '42501',
      });
    }
    for (const [sql, constraint] of [
      [
        `UPDATE forms.form_submission SET status = 'approved' WHERE id = $1`,
        'form_submission_status_check',
      ],
      [
        `UPDATE forms.form_submission SET version = 0 WHERE id = $1`,
        'form_submission_version_check',
      ],
      [
        `UPDATE platform.subject_key SET wrapped_key = '\\x00' WHERE subject_id = $1`,
        'subject_key_state_check',
      ],
    ] as const) {
      await expect(asApplication(sql, [done.submissionId])).rejects.toMatchObject({ constraint });
    }
  });
});
