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
import type { ActorGrant } from '../../src/platform/authz/actor-grants';
import {
  ALL_DEFINITIONS,
  type DefinitionQualifier,
} from '../../src/platform/authz/definition-scope';
import type { FieldGrant, FieldMode } from '../../src/platform/authz/field-policy';
import type { PermissionDeclaration } from '../../src/platform/authz/permission';
import type { GrantScope } from '../../src/platform/authz/roles/role-model';
import { createUseCaseGate } from '../../src/platform/authz/use-case-gate';
import { PrismaSubjectKeyStore } from '../../src/platform/persistence/subject-keys/prisma-subject-key-store';
import { SubjectKeyCipher } from '../../src/platform/subject-keys/subject-key-cipher';
import { SubjectKeyService } from '../../src/platform/subject-keys/subject-key.service';
import { loadTenantConfigs } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { StaleAggregateError } from '../../src/platform/unit-of-work/errors';
import { DefinitionReach } from '../../src/modules/objects/application/definition-reach';
import { RecordAccess } from '../../src/modules/objects/application/record-access';
import { CreateDefinition } from '../../src/modules/objects/application/use-cases/create-definition.use-case';
import { CreateRecord } from '../../src/modules/objects/application/use-cases/create-record.use-case';
import { DeleteRecord } from '../../src/modules/objects/application/use-cases/delete-record.use-case';
import { DescribeObject } from '../../src/modules/objects/application/use-cases/describe-object.use-case';
import { ListDefinitions } from '../../src/modules/objects/application/use-cases/list-definitions.use-case';
import { ListRecords } from '../../src/modules/objects/application/use-cases/list-records.use-case';
import { PublishDefinition } from '../../src/modules/objects/application/use-cases/publish-definition.use-case';
import { RenameDefinition } from '../../src/modules/objects/application/use-cases/rename-definition.use-case';
import { RetireDefinition } from '../../src/modules/objects/application/use-cases/retire-definition.use-case';
import { SaveRevision } from '../../src/modules/objects/application/use-cases/save-revision.use-case';
import { UpdateRecord } from '../../src/modules/objects/application/use-cases/update-record.use-case';
import { ViewDefinition } from '../../src/modules/objects/application/use-cases/view-definition.use-case';
import { ViewRecord } from '../../src/modules/objects/application/use-cases/view-record.use-case';
import { ViewRevision } from '../../src/modules/objects/application/use-cases/view-revision.use-case';
import {
  OBJECTS_DEFINITIONS_DESIGN,
  OBJECTS_DEFINITIONS_VIEW,
  OBJECTS_PERMISSIONS,
  OBJECTS_RECORD_CREATE,
  OBJECTS_RECORD_DELETE,
  OBJECTS_RECORD_READ,
  OBJECTS_RECORD_UPDATE,
} from '../../src/modules/objects/contracts/permissions';
import { OBJECTS_AUDIT_ACTIONS } from '../../src/modules/objects/domain/audit-actions';
import type { FieldInput, ObjectField } from '../../src/modules/objects/domain/fields';
import { PrismaDefinitionRepository } from '../../src/modules/objects/infrastructure/prisma-definition.repository';
import { PrismaRecordRepository } from '../../src/modules/objects/infrastructure/prisma-record.repository';
import { CreateSite } from '../../src/modules/tenancy/application/use-cases/create-site.use-case';
import { TENANCY_PERMISSIONS } from '../../src/modules/tenancy/contracts/permissions';
import { PrismaOrganizationRepository } from '../../src/modules/tenancy/infrastructure/prisma-organization.repository';
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
import { testDatabaseUrl } from './test-database';

// Phase 2 slice 2.8: the objects module end to end against PostgreSQL, on both tenant fixtures:
// definitions and immutable revisions with stable field ids, records sealed under their own
// subject key, record-level access by site (ADR-0017 decision 5) and field-level access through
// FieldPolicy (ADR-0024: a hidden field is absent from every read, a field that is not `edit`
// cannot be written), deletion with key destruction, and the row-level security and grants of
// the new tables. Grants and field rules come from an in-test reader per staff member, as
// identity's readers answer them; sites, units, repositories and keys are the real thing.

const AUDITED = new Map(OBJECTS_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(_context: CallContext, entry: AuditEntry): Promise<void> {
    if (entry.action.startsWith('tenancy.')) return Promise.resolve();
    const definition = AUDITED.get(entry.action);
    if (definition === undefined) throw new Error(`undeclared audit action ${entry.action}`);
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
  of(targetId: string): string[] {
    return this.entries.filter((entry) => entry.targetId === targetId).map((e) => e.action);
  }
}

const unique = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

const FIELDS: FieldInput[] = [
  { key: 'title', label: 'عنوان', type: 'text', required: true, sensitive: false },
  { key: 'national-id', label: 'کد ملی', type: 'text' },
  { key: 'note', label: 'یادداشت', type: 'long-text', sensitive: false },
  { key: 'amount', label: 'مبلغ', type: 'decimal', sensitive: false },
];
const VALUES = {
  title: 'قرارداد ۱',
  'national-id': '0012345678',
  note: 'محرمانه نیست',
  amount: '۱۲۰۰٫۵',
};

const ALL_KEYS = OBJECTS_PERMISSIONS.declarations.map((d) => d.key);

describe.each(TEST_TENANTS)('the objects module in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-28T13:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
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
  const accountOf = (context: CallContext): string =>
    context.actor.kind === 'authenticated' ? context.actor.accountId : '';
  const fieldRules = {
    grantsFor: (context: CallContext) =>
      Promise.resolve(grantsByAccount.get(accountOf(context)) ?? []),
  };
  const actorGrants = {
    grantsOf: (context: CallContext): Promise<readonly ActorGrant[]> =>
      Promise.resolve(
        (grantsByAccount.get(accountOf(context)) ?? []).map((grant) => ({
          roleId: ids.next<'Role'>(),
          scope: grant.scope,
          keys: grant.keys,
        })),
      ),
  };

  interface GrantSpec {
    readonly keys: readonly string[];
    readonly scope?: GrantScope;
    readonly definitions?: DefinitionQualifier;
    readonly rules?: Readonly<Record<string, FieldMode>>;
  }
  /** A staff member holding one grant per spec. */
  function staffWith(...specs: GrantSpec[]): CallContext {
    const context = testCallContext(
      tenant,
      testAuthenticatedActor(tenant, {
        population: 'tenant-staff',
        accountId: ids.next<'Account'>(),
        sessionId: ids.next<'Session'>(),
      }),
    );
    grantsByAccount.set(
      accountOf(context),
      specs.map((spec) => ({
        scope: spec.scope ?? { level: 'tenant' },
        keys: new Set(spec.keys),
        qualifiers: new Map(spec.keys.map((key) => [key, spec.definitions ?? ALL_DEFINITIONS])),
        fieldRules: new Map(
          Object.entries(spec.rules ?? {}).map(([id, mode]) => [id as Id<'Field'>, mode]),
        ),
      })),
    );
    return context;
  }
  const admin = staffWith({ keys: ALL_KEYS });

  let useCases: ReturnType<typeof build>;
  function build(p: Persistence) {
    const declared = new Map<string, PermissionDeclaration>(
      [...OBJECTS_PERMISSIONS.declarations, ...TENANCY_PERMISSIONS.declarations].map((d) => [
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
    const ancestry = new ClosureSiteAncestryReader(uow, sites);
    const definitions = new PrismaDefinitionRepository(p.service);
    const records = new PrismaRecordRepository(p.service);
    const reach = new DefinitionReach(uow, definitions, actorGrants, ancestry);
    const access = new RecordAccess(fieldRules, ancestry);
    const keys = new SubjectKeyService(
      new SubjectKeyCipher(Buffer.from(TEST_SUBJECT_KEY_KEK, 'base64url')),
      new PrismaSubjectKeyStore(p.service),
    );
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
      create: new CreateDefinition(gate, uow, definitions, reach, ancestry, audit, clock, ids),
      rename: new RenameDefinition(gate, uow, definitions, reach, audit, clock),
      save: new SaveRevision(gate, uow, definitions, reach, audit, clock, ids),
      publish: new PublishDefinition(gate, uow, definitions, reach, audit, clock),
      retire: new RetireDefinition(gate, uow, definitions, reach, audit, clock),
      list: new ListDefinitions(gate, uow, definitions, reach),
      view: new ViewDefinition(gate, uow, definitions, reach),
      viewRevision: new ViewRevision(gate, uow, definitions, reach),
      describe: new DescribeObject(gate, uow, definitions, access),
      records: new ListRecords(gate, uow, definitions, records, access, keys),
      record: new ViewRecord(gate, uow, definitions, records, access, keys),
      add: new CreateRecord(gate, uow, definitions, records, access, keys, audit, clock, ids),
      change: new UpdateRecord(gate, uow, definitions, records, access, keys, audit, clock),
      remove: new DeleteRecord(gate, uow, definitions, records, access, keys, audit, clock),
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

  async function newSite(parentSiteId: Id<'Site'> | null = null): Promise<Id<'Site'>> {
    const created = await useCases.createSite.execute(admin, {
      parentSiteId,
      organizationId: null,
      slug: unique('s'),
      name: 'سایت',
    });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    return created.value.id;
  }

  /** A published definition at `siteId` with FIELDS; its key and fields. */
  async function published(siteId: Id<'Site'>) {
    const key = unique('contracts');
    const created = await useCases.create.execute(admin, { siteId, key, name: 'قراردادها' });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    const saved = await useCases.save.execute(admin, {
      definitionId: created.value.id,
      fields: FIELDS,
    });
    if (!saved.ok) throw new Error(`setup: ${saved.error.code}`);
    const done = await useCases.publish.execute(admin, {
      definitionId: created.value.id,
      version: 1,
      revisionId: saved.value.id,
    });
    if (!done.ok) throw new Error(`setup: ${done.error.code}`);
    const field = (fieldKey: string): ObjectField =>
      saved.value.fields.find((f) => f.key === fieldKey)!;
    // Every key, and a rule opening the sensitive national id: without one it is hidden for
    // writing too (ADR-0024 decision 4), so no record with it could be created.
    const clerk = staffWith({ keys: ALL_KEYS, rules: { [field('national-id').id]: 'edit' } });
    return { id: created.value.id, key, revision: saved.value, field, clerk };
  }

  async function addRecord(of: CallContext, key: string, siteId: Id<'Site'> | null = null) {
    const added = await useCases.add.execute(of, { definitionKey: key, siteId, values: VALUES });
    if (!added.ok) throw new Error(`setup: ${added.error.code}`);
    return added.value.id;
  }

  it('creates, revises, renames, publishes and retires a definition (V1)', async () => {
    const siteId = await newSite();
    const key = unique('projects');
    const created = await useCases.create.execute(admin, { siteId, key, name: ' پروژه‌ها ' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const definitionId = created.value.id;
    expect(await useCases.create.execute(admin, { siteId, key, name: 'x' })).toEqual({
      ok: false,
      error: { code: 'objects.definition.key-taken' },
    });

    const first = await useCases.save.execute(admin, { definitionId, fields: FIELDS });
    expect(first.ok && first.value.number).toBe(1);
    if (!first.ok) return;
    expect(first.value.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const titleId = first.value.fields[0]!.id;
    // A rename keeps the id; lowering the sensitive national id needs the protected key.
    const renamed = FIELDS.map((f) =>
      f.key === 'title' ? { ...f, key: 'subject', id: titleId } : f,
    );
    const second = await useCases.save.execute(admin, { definitionId, fields: renamed });
    expect(second.ok && second.value.fields[0]).toMatchObject({ id: titleId, key: 'subject' });
    const designer = staffWith({
      keys: [OBJECTS_DEFINITIONS_DESIGN.key, OBJECTS_DEFINITIONS_VIEW.key],
    });
    const lowered = FIELDS.map((f) => (f.key === 'national-id' ? { ...f, sensitive: false } : f));
    expect(await useCases.save.execute(designer, { definitionId, fields: lowered })).toEqual({
      ok: false,
      error: { code: 'objects.revision.lowering-denied' },
    });
    const third = await useCases.save.execute(admin, { definitionId, fields: lowered });
    expect(third.ok && third.value.number).toBe(3);
    if (!third.ok) return;
    expect(audit.of(third.value.id)).toEqual([
      'objects.revision.saved',
      'objects.revision.sensitivity-lowered',
    ]);

    expect(
      await useCases.rename.execute(admin, { definitionId, version: 1, name: 'پروژه' }),
    ).toEqual({ ok: true, value: undefined });
    await expect(
      useCases.rename.execute(admin, { definitionId, version: 1, name: 'دوباره' }),
    ).rejects.toThrow(StaleAggregateError);
    expect(
      await useCases.publish.execute(admin, {
        definitionId,
        version: 2,
        revisionId: third.value.id,
      }),
    ).toEqual({ ok: true, value: undefined });
    const viewed = await useCases.view.execute(admin, { definitionId });
    expect(viewed.ok && viewed.value.definition).toMatchObject({
      name: 'پروژه',
      status: 'published',
      publishedRevisionId: third.value.id,
      latestRevisionNumber: 3,
      version: 3,
    });
    expect(viewed.ok && viewed.value.revisions.map((r) => r.number)).toEqual([3, 2, 1]);
    expect(await useCases.retire.execute(admin, { definitionId, version: 3 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(audit.of(definitionId)).toEqual([
      'objects.definition.created',
      'objects.definition.renamed',
      'objects.definition.published',
      'objects.definition.retired',
    ]);
  });

  it('keeps definitions within the reach of site grants (ADR-0018)', async () => {
    const root = await newSite();
    const outside = await newSite();
    const { id } = await published(root);
    const local = staffWith({
      keys: [OBJECTS_DEFINITIONS_VIEW.key, OBJECTS_DEFINITIONS_DESIGN.key],
      scope: { level: 'site', siteId: outside, includeDescendants: true },
    });
    expect(await useCases.view.execute(local, { definitionId: id })).toEqual({
      ok: false,
      error: { code: 'objects.definition.not-found' },
    });
    const listed = await useCases.list.execute(local, { siteId: null, status: null });
    expect(listed.ok && listed.value.some((d) => d.id === id)).toBe(false);
    expect(
      await useCases.create.execute(local, { siteId: root, key: unique('x'), name: 'x' }),
    ).toEqual({ ok: false, error: { code: 'objects.site.not-found' } });
  });

  it('seals sensitive values under the record key and shows them only through field rules', async () => {
    const siteId = await newSite();
    const object = await published(siteId);
    const recordId = await addRecord(object.clerk, object.key);
    const nationalId = object.field('national-id').id;
    // Without a rule the sensitive field is not `edit` even for a holder of every key.
    expect(
      await useCases.add.execute(admin, {
        definitionKey: object.key,
        siteId: null,
        values: VALUES,
      }),
    ).toEqual({ ok: false, error: { code: 'access.field-denied' } });
    const note = object.field('note').id;

    const [row] = await asApplication<{ values: Record<string, unknown>; sealed: Buffer }>(
      'SELECT "values", sealed FROM objects.object_record WHERE id = $1',
      [recordId],
    );
    expect(Object.keys(row!.values).sort()).toEqual(
      [object.field('title').id, note, object.field('amount').id].sort(),
    );
    expect(row!.values[object.field('amount').id]).toBe('1200.5');
    expect(row!.sealed.includes(Buffer.from('0012345678'))).toBe(false);
    expect(
      await asApplication('SELECT 1 FROM platform.subject_key WHERE subject_id = $1', [recordId]),
    ).toHaveLength(1);

    // A sensitive field without a rule is hidden, even to a holder of every key (D9).
    const asAdmin = await useCases.record.execute(admin, { definitionKey: object.key, recordId });
    expect(asAdmin.ok && asAdmin.value.values).toEqual({
      title: 'قرارداد ۱',
      note: 'محرمانه نیست',
      amount: '1200.5',
    });
    const opened = staffWith({
      keys: [OBJECTS_RECORD_READ.key],
      rules: { [nationalId]: 'read', [note]: 'hidden' },
    });
    const asOpened = await useCases.record.execute(opened, { definitionKey: object.key, recordId });
    expect(asOpened.ok && asOpened.value.values).toEqual({
      title: 'قرارداد ۱',
      'national-id': '0012345678',
      amount: '1200.5',
    });
    const listed = await useCases.records.execute(opened, {
      definitionKey: object.key,
      siteId: null,
      before: null,
      limit: 10,
    });
    expect(
      listed.ok && listed.value.items.find((r) => r.id === recordId)?.values,
    ).not.toHaveProperty('note');

    // Describe names only what the caller may read or write.
    const described = await useCases.describe.execute(opened, {
      definitionKey: object.key,
      siteId: null,
    });
    expect(described.ok && described.value.fields.map((f) => [f.key, f.read, f.update])).toEqual([
      ['title', true, false],
      ['national-id', true, false],
      ['amount', true, false],
    ]);
  });

  it('never mixes read and write across grants, and refuses writes to fields not edit', async () => {
    const siteId = await newSite();
    const object = await published(siteId);
    const recordId = await addRecord(object.clerk, object.key);
    const note = object.field('note').id;
    const nationalId = object.field('national-id').id;
    // A read grant hides the note; an update grant opens the note and the national id.
    const mixed = staffWith(
      { keys: [OBJECTS_RECORD_READ.key], rules: { [note]: 'hidden' } },
      { keys: [OBJECTS_RECORD_UPDATE.key], rules: { [nationalId]: 'edit' } },
    );
    const seen = await useCases.record.execute(mixed, { definitionKey: object.key, recordId });
    expect(seen.ok && Object.keys(seen.value.values).sort()).toEqual(['amount', 'title']);
    expect(
      await useCases.change.execute(mixed, {
        definitionKey: object.key,
        recordId,
        version: 1,
        values: { note: 'تازه', 'national-id': '0099999999' },
      }),
    ).toEqual({ ok: true, value: { id: recordId, version: 2 } });

    // An update-only member writes but cannot read back (review M1 of slice 2.0).
    const writer = staffWith({ keys: [OBJECTS_RECORD_UPDATE.key] });
    expect(await useCases.record.execute(writer, { definitionKey: object.key, recordId })).toEqual({
      ok: false,
      error: { code: 'objects.record.not-found' },
    });
    expect(
      await useCases.change.execute(writer, {
        definitionKey: object.key,
        recordId,
        version: 2,
        values: { title: 'عنوان تازه' },
      }),
    ).toEqual({ ok: true, value: { id: recordId, version: 3 } });
    // The sensitive field has no rule for this writer, and an unknown key is refused the same
    // way: no failure tells which keys exist.
    for (const values of [{ 'national-id': '1' }, { secret: 'x' }, { title: 'x', note: null }]) {
      const refused = await useCases.change.execute(
        staffWith({ keys: [OBJECTS_RECORD_UPDATE.key], rules: { [note]: 'read' } }),
        { definitionKey: object.key, recordId, version: 3, values },
      );
      expect(refused).toEqual({ ok: false, error: { code: 'access.field-denied' } });
    }
    expect(
      await useCases.change.execute(admin, {
        definitionKey: object.key,
        recordId,
        version: 3,
        values: { title: null },
      }),
    ).toEqual({ ok: false, error: { code: 'objects.record.invalid', field: 'title' } });
    await expect(
      useCases.change.execute(admin, {
        definitionKey: object.key,
        recordId,
        version: 2,
        values: { note: 'دیر' },
      }),
    ).rejects.toThrow(StaleAggregateError);

    const opened = staffWith({
      keys: [OBJECTS_RECORD_READ.key],
      rules: { [nationalId]: 'read' },
    });
    const after = await useCases.record.execute(opened, { definitionKey: object.key, recordId });
    expect(after.ok && after.value).toMatchObject({
      version: 3,
      values: { title: 'عنوان تازه', 'national-id': '0099999999', note: 'تازه' },
    });
    expect(audit.of(recordId)).toEqual([
      'objects.record.created',
      'objects.record.updated',
      'objects.record.updated',
    ]);
  });

  it('owns records by site: a grant reaches its subtree only, in lists too (ADR-0017)', async () => {
    const root = await newSite();
    const province = await newSite(root);
    const elsewhere = await newSite();
    const object = await published(root);
    const atRoot = await addRecord(object.clerk, object.key);
    const provincial = staffWith({
      keys: [OBJECTS_RECORD_READ.key, OBJECTS_RECORD_CREATE.key, OBJECTS_RECORD_DELETE.key],
      scope: { level: 'site', siteId: province, includeDescendants: true },
      rules: { [object.field('national-id').id]: 'edit' },
    });
    const atProvince = await addRecord(provincial, object.key, province);
    expect(
      await useCases.add.execute(provincial, {
        definitionKey: object.key,
        siteId: null,
        values: VALUES,
      }),
    ).toEqual({ ok: false, error: { code: 'objects.definition.not-found' } });
    expect(
      await useCases.add.execute(provincial, {
        definitionKey: object.key,
        siteId: root,
        values: VALUES,
      }),
    ).toEqual({ ok: false, error: { code: 'objects.site.not-found' } });
    expect(
      await useCases.add.execute(admin, {
        definitionKey: object.key,
        siteId: elsewhere,
        values: VALUES,
      }),
    ).toEqual({ ok: false, error: { code: 'objects.site.not-found' } });

    const listed = await useCases.records.execute(provincial, {
      definitionKey: object.key,
      siteId: null,
      before: null,
      limit: 10,
    });
    expect(listed.ok && listed.value.items.map((r) => r.id)).toEqual([atProvince]);
    expect(
      await useCases.record.execute(provincial, { definitionKey: object.key, recordId: atRoot }),
    ).toEqual({ ok: false, error: { code: 'objects.record.not-found' } });
    expect(
      await useCases.remove.execute(provincial, {
        definitionKey: object.key,
        recordId: atRoot,
        version: 1,
      }),
    ).toEqual({ ok: false, error: { code: 'objects.record.not-found' } });
    const all = await useCases.records.execute(admin, {
      definitionKey: object.key,
      siteId: null,
      before: null,
      limit: 1,
    });
    expect(all.ok && all.value.items.map((r) => r.id)).toEqual([atProvince]);
    const next = all.ok ? all.value.next : null;
    expect(next).toBe(atProvince);
    const second = await useCases.records.execute(admin, {
      definitionKey: object.key,
      siteId: null,
      before: next,
      limit: 1,
    });
    expect(second.ok && second.value).toEqual({
      items: [expect.objectContaining({ id: atRoot })],
      next: null,
    });

    // A grant elsewhere reaches no site of the definition: it is not found at all.
    const stranger = staffWith({
      keys: [OBJECTS_RECORD_READ.key],
      scope: { level: 'site', siteId: elsewhere, includeDescendants: true },
    });
    for (const result of [
      await useCases.records.execute(stranger, {
        definitionKey: object.key,
        siteId: null,
        before: null,
        limit: 10,
      }),
      await useCases.describe.execute(stranger, { definitionKey: object.key, siteId: null }),
    ]) {
      expect(result).toEqual({ ok: false, error: { code: 'objects.definition.not-found' } });
    }
    // A qualifier for another definition covers none of this one's records.
    const otherDefinition = staffWith({
      keys: [OBJECTS_RECORD_READ.key],
      definitions: { all: false, definitionIds: new Set([ids.next<'Definition'>()]) },
    });
    expect(
      await useCases.record.execute(otherDefinition, {
        definitionKey: object.key,
        recordId: atRoot,
      }),
    ).toEqual({ ok: false, error: { code: 'objects.record.not-found' } });
  });

  it('writes under the published revision, stops at retirement, deletes with the key', async () => {
    const siteId = await newSite();
    const object = await published(siteId);
    const recordId = await addRecord(object.clerk, object.key);
    // Revision 2 drops the note: the next update drops its value too.
    const saved = await useCases.save.execute(admin, {
      definitionId: object.id,
      fields: FIELDS.filter((f) => f.key !== 'note'),
    });
    if (!saved.ok) throw new Error('setup');
    await useCases.publish.execute(admin, {
      definitionId: object.id,
      version: 2,
      revisionId: saved.value.id,
    });
    const stillOld = await useCases.record.execute(admin, { definitionKey: object.key, recordId });
    expect(stillOld.ok && stillOld.value).toMatchObject({ revisionNumber: 1 });
    expect(stillOld.ok && stillOld.value.values).toHaveProperty('note');
    await useCases.change.execute(admin, {
      definitionKey: object.key,
      recordId,
      version: 1,
      values: { amount: 5 },
    });
    const moved = await useCases.record.execute(admin, { definitionKey: object.key, recordId });
    expect(moved.ok && moved.value).toMatchObject({
      revisionNumber: 2,
      values: { title: 'قرارداد ۱', amount: '5' },
    });
    expect(moved.ok && moved.value.values).not.toHaveProperty('note');

    await useCases.retire.execute(admin, { definitionId: object.id, version: 3 });
    expect(
      await useCases.add.execute(admin, {
        definitionKey: object.key,
        siteId: null,
        values: VALUES,
      }),
    ).toEqual({ ok: false, error: { code: 'objects.definition.not-accepting' } });
    expect((await useCases.record.execute(admin, { definitionKey: object.key, recordId })).ok).toBe(
      true,
    );
    await expect(
      useCases.remove.execute(admin, { definitionKey: object.key, recordId, version: 1 }),
    ).rejects.toThrow(StaleAggregateError);
    expect(
      await useCases.remove.execute(admin, { definitionKey: object.key, recordId, version: 2 }),
    ).toEqual({ ok: true, value: undefined });
    expect(
      await asApplication('SELECT 1 FROM objects.object_record WHERE id = $1', [recordId]),
    ).toEqual([]);
    expect(
      await asApplication<{ destroyed: boolean }>(
        'SELECT wrapped_key IS NULL AS destroyed FROM platform.subject_key WHERE subject_id = $1',
        [recordId],
      ),
    ).toEqual([{ destroyed: true }]);
    expect(await useCases.record.execute(admin, { definitionKey: object.key, recordId })).toEqual({
      ok: false,
      error: { code: 'objects.record.not-found' },
    });
  });

  it('isolates tenants by row-level security and keeps revisions immutable', async () => {
    const siteId = await newSite();
    const object = await published(siteId);
    const recordId = await addRecord(object.clerk, object.key);
    for (const table of ['object_definition', 'object_revision', 'object_record']) {
      expect(
        await asApplication(
          `SELECT 1 FROM objects.${table} WHERE tenant_id = $1`,
          [tenant.tenantId],
          other,
        ),
      ).toEqual([]);
    }
    await expect(
      asApplication('UPDATE objects.object_revision SET number = 9 WHERE id = $1', [
        object.revision.id,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApplication('UPDATE objects.object_record SET site_id = $2 WHERE id = $1', [
        recordId,
        siteId,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApplication('DELETE FROM objects.object_definition WHERE id = $1', [object.id]),
    ).rejects.toThrow(/permission denied/);
    // Another tenant's actor does not find the definition by key.
    const foreign = testCallContext(
      other,
      testAuthenticatedActor(other, {
        population: 'tenant-staff',
        accountId: accountOf(admin) as Id<'Account'>,
        sessionId: ids.next<'Session'>(),
      }),
    );
    expect(await useCases.record.execute(foreign, { definitionKey: object.key, recordId })).toEqual(
      { ok: false, error: { code: 'objects.definition.not-found' } },
    );
  });
});
