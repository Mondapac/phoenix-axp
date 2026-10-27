import { randomUUID } from 'node:crypto';
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
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
import { CreateForm } from '../../src/modules/forms/application/use-cases/create-form.use-case';
import { ListForms } from '../../src/modules/forms/application/use-cases/list-forms.use-case';
import { PublishForm } from '../../src/modules/forms/application/use-cases/publish-form.use-case';
import { RetireForm } from '../../src/modules/forms/application/use-cases/retire-form.use-case';
import { SaveFormRevision } from '../../src/modules/forms/application/use-cases/save-form-revision.use-case';
import { UpdateForm } from '../../src/modules/forms/application/use-cases/update-form.use-case';
import { ViewFormRevision } from '../../src/modules/forms/application/use-cases/view-form-revision.use-case';
import { ViewForm } from '../../src/modules/forms/application/use-cases/view-form.use-case';
import { FORMS_PERMISSIONS } from '../../src/modules/forms/contracts/permissions';
import { FORMS_AUDIT_ACTIONS } from '../../src/modules/forms/domain/audit-actions';
import { AjvFormSchemaChecker } from '../../src/modules/forms/infrastructure/ajv-form-schema-checker';
import { PrismaFormRepository } from '../../src/modules/forms/infrastructure/prisma-form.repository';
import { CreateSite } from '../../src/modules/tenancy/application/use-cases/create-site.use-case';
import { TENANCY_PERMISSIONS } from '../../src/modules/tenancy/contracts/permissions';
import { PrismaOrganizationRepository } from '../../src/modules/tenancy/infrastructure/prisma-organization.repository';
import { PrismaSiteRepository } from '../../src/modules/tenancy/infrastructure/prisma-site.repository';
import { PrismaTenantSettingsRepository } from '../../src/modules/tenancy/infrastructure/prisma-tenant-settings.repository';
import { ClosureSiteAncestryReader } from '../../src/modules/tenancy/infrastructure/site-ancestry.reader';
import { TEST_TENANT_CONFIG_DIRS, TEST_TENANTS, testTenantId } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { testDatabaseUrl } from './test-database';

// Phase 2 slice 2.4: the forms use cases end to end against PostgreSQL, through the real
// repository, UnitOfWork, tenant guard, row-level security and the Ajv checker. Sites come from
// tenancy's use case and its closure-table reader, as in the running application. The gate
// admits a staff actor; the audit writer is a recorder that checks every entry against its
// definition, as the platform writer does.

const DEFINITIONS = new Map(FORMS_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(_context: CallContext, entry: AuditEntry): Promise<void> {
    // Tenancy's own entries (the setup's sites) are not this module's to check.
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
  actions(): string[] {
    return this.entries.map((entry) => entry.action);
  }
}

const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

const jsonSchema = {
  type: 'object',
  required: ['fullName'],
  properties: {
    fullName: { type: 'string', minLength: 2 },
    visitDate: { type: 'string', format: 'date' },
  },
};
const uiSchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/fullName' },
    { type: 'Control', scope: '#/properties/visitDate' },
  ],
};
const anyone = { audience: 'anyone', roleIds: [], allowOnBehalf: false } as const;

describe.each(TEST_TENANTS)('the forms module in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  // A clock per tenant, so the two runs never mint the same ids into the shared database.
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-27T14:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  let persistence: Persistence;
  /** The application login, reading and writing rows of the tenant under row-level security. */
  let app: Client;
  async function asApplication<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
    await app.query('BEGIN');
    try {
      await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
      return (await app.query<R>(sql, params)).rows;
    } finally {
      await app.query('ROLLBACK');
    }
  }

  const staff = (of: TenantContext): CallContext =>
    testCallContext(
      of,
      testAuthenticatedActor(of, {
        population: 'tenant-staff',
        accountId: ids.next<'Account'>(),
        sessionId: ids.next<'Session'>(),
      }),
    );
  const context = staff(tenant);

  let useCases: ReturnType<typeof build>;
  function build(p: Persistence) {
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
    const reader = new ClosureSiteAncestryReader(uow, sites);
    const checker = new AjvFormSchemaChecker();
    return {
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
      createForm: new CreateForm(gate, uow, forms, reader, audit, clock, ids),
      updateForm: new UpdateForm(gate, uow, forms, audit, clock),
      saveRevision: new SaveFormRevision(gate, uow, forms, checker, audit, clock, ids),
      publishForm: new PublishForm(gate, uow, forms, audit, clock),
      retireForm: new RetireForm(gate, uow, forms, audit, clock),
      listForms: new ListForms(gate, uow, forms),
      viewForm: new ViewForm(gate, uow, forms),
      viewRevision: new ViewFormRevision(gate, uow, forms),
    };
  }

  beforeAll(async () => {
    persistence = createPersistence();
    app = new Client({ connectionString: testDatabaseUrl() });
    await app.connect();
    useCases = build(persistence);
  });

  afterAll(async () => {
    await app.end();
    await persistence.close();
  });

  async function site(of: CallContext = context): Promise<Id<'Site'>> {
    const created = await useCases.createSite.execute(of, {
      parentSiteId: null,
      organizationId: null,
      slug: unique('s'),
      name: 'سایت',
    });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    return created.value.id;
  }

  async function form(of: CallContext = context, siteId?: Id<'Site'>): Promise<Id<'Form'>> {
    const created = await useCases.createForm.execute(of, {
      siteId: siteId ?? (await site(of)),
      key: unique('f'),
      name: 'درخواست ملاقات',
      policy: anyone,
    });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    return created.value.id;
  }

  async function revision(formId: Id<'Form'>, of: CallContext = context) {
    const saved = await useCases.saveRevision.execute(of, { formId, jsonSchema, uiSchema });
    if (!saved.ok) throw new Error(`setup: ${saved.error.code}`);
    return saved.value;
  }

  async function view(formId: Id<'Form'>) {
    const viewed = await useCases.viewForm.execute(context, { formId });
    if (!viewed.ok) throw new Error(`view: ${viewed.error.code}`);
    return viewed.value;
  }

  it('creates a draft that keeps personal data forever by default (D5)', async () => {
    const siteId = await site();
    const created = await useCases.createForm.execute(context, {
      siteId,
      key: unique('visit'),
      name: '  درخواست ملاقات ',
      policy: anyone,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await view(created.value.id)).toMatchObject({
      siteId,
      name: 'درخواست ملاقات',
      status: 'draft',
      publishedRevisionId: null,
      policy: anyone,
      retention: { kind: 'forever' },
      latestRevisionNumber: 0,
      version: 1,
      revisions: [],
    });
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'forms.form.created',
      targetId: created.value.id,
      after: { siteId, audience: 'anyone', roleIds: [], retentionDays: null },
    });
  });

  it('refuses an unknown or foreign site, a key in use and a bad policy, writing nothing', async () => {
    const siteId = await site();
    const key = unique('dup');
    expect(
      (await useCases.createForm.execute(context, { siteId, key, name: 'x', policy: anyone })).ok,
    ).toBe(true);
    const recorded = audit.entries.length;
    expect(
      await useCases.createForm.execute(context, { siteId, key, name: 'y', policy: anyone }),
    ).toEqual({ ok: false, error: { code: 'forms.form.key-taken' } });
    for (const unknown of [ids.next<'Site'>(), await site(staff(other))]) {
      expect(
        await useCases.createForm.execute(context, {
          siteId: unknown,
          key: unique('f'),
          name: 'x',
          policy: anyone,
        }),
      ).toEqual({ ok: false, error: { code: 'forms.site.not-found' } });
    }
    expect(
      await useCases.createForm.execute(context, {
        siteId,
        key: unique('f'),
        name: 'x',
        policy: { audience: 'staff-roles', roleIds: [], allowOnBehalf: false },
      }),
    ).toEqual({ ok: false, error: { code: 'forms.value.invalid', field: 'roleIds' } });
    expect(audit.entries.length).toBe(recorded);
  });

  it('saves immutable revisions numbered 1, 2 ... with their content hash', async () => {
    const formId = await form();
    const first = await revision(formId);
    const second = await useCases.saveRevision.execute(context, {
      formId,
      jsonSchema: { ...jsonSchema, title: 'دوم' },
      uiSchema,
    });
    expect(first.number).toBe(1);
    expect(second.ok && second.value.number).toBe(2);
    expect(second.ok && second.value.contentHash).not.toBe(first.contentHash);
    // Saving does not touch the form's own version or publish anything.
    expect(await view(formId)).toMatchObject({
      status: 'draft',
      version: 1,
      latestRevisionNumber: 2,
      revisions: [{ number: 2 }, { number: 1, id: first.id, contentHash: first.contentHash }],
    });
    expect(await useCases.viewRevision.execute(context, { revisionId: first.id })).toEqual({
      ok: true,
      value: expect.objectContaining({ formId, number: 1, jsonSchema, uiSchema }) as unknown,
    });
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'forms.form-revision.saved',
      after: { formId, number: 2 },
    });
  });

  it('refuses an invalid schema with its problem and place, and an unknown form', async () => {
    const formId = await form();
    const recorded = audit.entries.length;
    expect(
      await useCases.saveRevision.execute(context, {
        formId,
        jsonSchema,
        uiSchema: { type: 'Control', scope: '#/properties/age' },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'forms.schema.invalid',
        field: 'uiSchema',
        problem: 'scope-unresolved',
        pointer: '/scope',
      },
    });
    expect(
      await useCases.saveRevision.execute(context, {
        formId: ids.next<'Form'>(),
        jsonSchema,
        uiSchema,
      }),
    ).toEqual({ ok: false, error: { code: 'forms.form.not-found' } });
    expect(audit.entries.length).toBe(recorded);
    expect((await view(formId)).latestRevisionNumber).toBe(0);
  });

  it('numbers concurrent saves without a repeat or a gap', async () => {
    const formId = await form();
    const saved = await Promise.all(
      Array.from({ length: 4 }, () =>
        useCases.saveRevision.execute(staff(tenant), { formId, jsonSchema, uiSchema }),
      ),
    );
    expect(saved.map((s) => (s.ok ? s.value.number : 0)).sort()).toEqual([1, 2, 3, 4]);
  });

  it('publishes, republishes, rolls back, retires and brings a form back, with versions', async () => {
    const formId = await form();
    const one = await revision(formId);
    const two = await revision(formId);
    const publish = (version: number, revisionId: Id<'FormRevision'>) =>
      useCases.publishForm.execute(context, { formId, version, revisionId });

    expect(await publish(1, one.id)).toEqual({ ok: true, value: undefined });
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'forms.form.published',
      before: { status: 'draft', revisionId: null },
      after: { revisionId: one.id, number: 1 },
    });
    expect(await publish(2, one.id)).toEqual({
      ok: false,
      error: { code: 'forms.form.already-published' },
    });
    expect((await publish(2, two.id)).ok).toBe(true);
    // Back to the first revision: a rollback is a publication.
    expect((await publish(3, one.id)).ok).toBe(true);
    await expect(publish(3, two.id)).rejects.toBeInstanceOf(StaleAggregateError);

    expect(await useCases.retireForm.execute(context, { formId, version: 4 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'forms.form.retired',
      before: { revisionId: one.id },
    });
    expect(await view(formId)).toMatchObject({
      status: 'retired',
      publishedRevisionId: one.id,
      version: 5,
    });
    expect(await useCases.retireForm.execute(context, { formId, version: 5 })).toEqual({
      ok: false,
      error: { code: 'forms.form.not-published' },
    });
    expect((await publish(5, two.id)).ok).toBe(true);
    expect(await view(formId)).toMatchObject({ status: 'published', publishedRevisionId: two.id });
  });

  it("refuses to publish another form's revision, as one that does not exist", async () => {
    const formId = await form();
    const elsewhere = await revision(await form());
    expect(
      await useCases.publishForm.execute(context, {
        formId,
        version: 1,
        revisionId: elsewhere.id,
      }),
    ).toEqual({ ok: false, error: { code: 'forms.form-revision.not-found' } });
    // The database refuses it too: the published revision's key includes the form.
    await expect(
      asApplication(
        `UPDATE forms.form SET status = 'published', published_revision_id = $2 WHERE id = $1`,
        [formId, elsewhere.id],
      ),
    ).rejects.toMatchObject({ constraint: 'form_published_revision_fkey' });
  });

  it('changes the settings with an optimistic version and audits before and after', async () => {
    const formId = await form();
    const roles = [ids.next<'Role'>(), ids.next<'Role'>()];
    const result = await useCases.updateForm.execute(context, {
      formId,
      version: 1,
      name: 'درخواست مرخصی',
      policy: { audience: 'staff-roles', roleIds: roles, allowOnBehalf: true },
      retention: { kind: 'fixed', days: 365 },
    });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await view(formId)).toMatchObject({
      name: 'درخواست مرخصی',
      policy: { audience: 'staff-roles', roleIds: roles, allowOnBehalf: true },
      retention: { kind: 'fixed', days: 365 },
      version: 2,
    });
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'forms.form.updated',
      before: { audience: 'anyone', retentionDays: null },
      after: { audience: 'staff-roles', roleIds: roles, retentionDays: 365, nameChanged: true },
    });
    await expect(
      useCases.updateForm.execute(context, {
        formId,
        version: 1,
        name: 'x',
        policy: anyone,
      }),
    ).rejects.toBeInstanceOf(StaleAggregateError);
  });

  it('lists the forms of a site and of a status', async () => {
    const siteId = await site();
    const draft = await form(context, siteId);
    const live = await form(context, siteId);
    await useCases.publishForm.execute(context, {
      formId: live,
      version: 1,
      revisionId: (await revision(live)).id,
    });
    const ofSite = await useCases.listForms.execute(context, { siteId, status: null });
    expect(ofSite.ok && ofSite.value.map((f) => f.id).sort()).toEqual([draft, live].sort());
    const published = await useCases.listForms.execute(context, {
      siteId,
      status: 'published',
    });
    expect(published.ok && published.value.map((f) => f.id)).toEqual([live]);
  });

  it('keeps a saved revision immutable: the application role cannot change or delete it', async () => {
    const saved = await revision(await form());
    await expect(
      asApplication(`UPDATE forms.form_revision SET ui_schema = '{}' WHERE id = $1`, [saved.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asApplication('DELETE FROM forms.form_revision WHERE id = $1', [saved.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asApplication('DELETE FROM forms.form WHERE id = $1', [saved.id]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('backs the domain rules with CHECKs', async () => {
    const formId = await form();
    for (const [sql, constraint] of [
      [`UPDATE forms.form SET status = 'published' WHERE id = $1`, 'form_status_check'],
      [`UPDATE forms.form SET audience = 'staff-roles' WHERE id = $1`, 'form_audience_check'],
      [`UPDATE forms.form SET retention_days = 0 WHERE id = $1`, 'form_retention_days_check'],
    ] as const) {
      await expect(asApplication(sql, [formId])).rejects.toMatchObject({ constraint });
    }
  });

  it("never sees, changes or publishes the other tenant's forms and revisions", async () => {
    const theirs = await form(staff(other));
    const theirRevision = await revision(theirs, staff(other));
    const notFound = { ok: false, error: { code: 'forms.form.not-found' } };
    expect(await useCases.viewForm.execute(context, { formId: theirs })).toEqual(notFound);
    expect(
      await useCases.updateForm.execute(context, {
        formId: theirs,
        version: 1,
        name: 'x',
        policy: anyone,
      }),
    ).toEqual(notFound);
    expect(
      await useCases.saveRevision.execute(context, { formId: theirs, jsonSchema, uiSchema }),
    ).toEqual(notFound);
    expect(
      await useCases.publishForm.execute(context, {
        formId: theirs,
        version: 1,
        revisionId: theirRevision.id,
      }),
    ).toEqual(notFound);
    expect(await useCases.retireForm.execute(context, { formId: theirs, version: 1 })).toEqual(
      notFound,
    );
    expect(await useCases.viewRevision.execute(context, { revisionId: theirRevision.id })).toEqual({
      ok: false,
      error: { code: 'forms.form-revision.not-found' },
    });
    const listed = await useCases.listForms.execute(context, { siteId: null, status: null });
    expect(listed.ok && listed.value.some((f) => f.id === theirs)).toBe(false);
    expect(
      await asApplication<{ n: string }>(
        'SELECT count(*) AS n FROM forms.form_revision WHERE id = $1',
        [theirRevision.id],
      ),
    ).toEqual([{ n: '0' }]);
  });
});
