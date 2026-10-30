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
import { AddSiteDomain } from '../../src/modules/tenancy/application/use-cases/add-site-domain.use-case';
import { CreateOrganization } from '../../src/modules/tenancy/application/use-cases/create-organization.use-case';
import { CreateSite } from '../../src/modules/tenancy/application/use-cases/create-site.use-case';
import { ListOrganizations } from '../../src/modules/tenancy/application/use-cases/list-organizations.use-case';
import { ListSites } from '../../src/modules/tenancy/application/use-cases/list-sites.use-case';
import { MoveOrganization } from '../../src/modules/tenancy/application/use-cases/move-organization.use-case';
import { MoveSite } from '../../src/modules/tenancy/application/use-cases/move-site.use-case';
import { RemoveSiteDomain } from '../../src/modules/tenancy/application/use-cases/remove-site-domain.use-case';
import { RenameOrganization } from '../../src/modules/tenancy/application/use-cases/rename-organization.use-case';
import { UpdateSite } from '../../src/modules/tenancy/application/use-cases/update-site.use-case';
import { UpdateTenantSettings } from '../../src/modules/tenancy/application/use-cases/update-tenant-settings.use-case';
import { ViewSite } from '../../src/modules/tenancy/application/use-cases/view-site.use-case';
import { ViewTenantSettings } from '../../src/modules/tenancy/application/use-cases/view-tenant-settings.use-case';
import { TENANCY_PERMISSIONS } from '../../src/modules/tenancy/contracts/permissions';
import { TENANCY_AUDIT_ACTIONS } from '../../src/modules/tenancy/domain/audit-actions';
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

// Phase 1 slice 1.4: the tenancy use cases end to end against PostgreSQL, through the real
// repositories, UnitOfWork, tenant guard and row-level security. The gate admits a staff actor
// (identity's authorisation check does not exist yet); the audit writer is a recorder that
// checks every entry against its definition, as the platform writer does.

const DEFINITIONS = new Map(TENANCY_AUDIT_ACTIONS.map((d) => [d.action as string, d]));

class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  record(_context: CallContext, entry: AuditEntry): Promise<void> {
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

describe.each(TEST_TENANTS)('the tenancy module in tenant %s (database integration)', (code) => {
  const tenant: TenantContext = tenantOf(code);
  const other: TenantContext = tenantOf(otherTenantOf(code));
  // A clock per tenant, so the two runs never mint the same ids into the shared database.
  const clock = new FixedClock(
    Temporal.Instant.from('2026-10-27T12:00:00Z').add({ hours: TEST_TENANTS.indexOf(code) }),
  );
  const ids = new SequenceIdGenerator(clock);
  const audit = new RecordingAuditWriter();
  let persistence: Persistence;
  /** The application login, reading rows of the tenant under row-level security. */
  let reader: Client;
  async function rowsOf<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
    await reader.query('BEGIN');
    try {
      await reader.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
        tenant.tenantId,
      ]);
      return (await reader.query<R>(sql, params)).rows;
    } finally {
      await reader.query('ROLLBACK');
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
      TENANCY_PERMISSIONS.declarations.map((d) => [d.key, d]),
    );
    const tenants = new TenantRegistry(
      loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANTS.map(testTenantId)),
    );
    const gate = createUseCaseGate(
      tenants,
      { get: (key) => declared.get(key) },
      {
        check: () => Promise.resolve({ allowed: true }),
      },
    );
    const uow = p.unitOfWork;
    const sites = new PrismaSiteRepository(p.service);
    const organizations = new PrismaOrganizationRepository(p.service);
    const settings = new PrismaTenantSettingsRepository(p.service);
    return {
      sites,
      reader: new ClosureSiteAncestryReader(uow, sites),
      createSite: new CreateSite(gate, uow, settings, sites, organizations, audit, clock, ids),
      updateSite: new UpdateSite(gate, uow, sites, organizations, audit, clock),
      moveSite: new MoveSite(gate, uow, settings, sites, audit, clock),
      listSites: new ListSites(gate, uow, sites),
      viewSite: new ViewSite(gate, uow, sites),
      addDomain: new AddSiteDomain(gate, uow, sites, audit, clock, ids),
      removeDomain: new RemoveSiteDomain(gate, uow, sites, audit),
      createOrganization: new CreateOrganization(
        gate,
        uow,
        settings,
        organizations,
        audit,
        clock,
        ids,
      ),
      renameOrganization: new RenameOrganization(gate, uow, organizations, audit, clock),
      moveOrganization: new MoveOrganization(gate, uow, settings, organizations, audit, clock),
      listOrganizations: new ListOrganizations(gate, uow, organizations),
      viewSettings: new ViewTenantSettings(gate, uow, settings, tenants),
      updateSettings: new UpdateTenantSettings(gate, uow, settings, sites, audit, clock),
    };
  }

  beforeAll(async () => {
    persistence = createPersistence();
    reader = new Client({ connectionString: testDatabaseUrl() });
    await reader.connect();
    useCases = build(persistence);
  });

  afterAll(async () => {
    await reader.end();
    await persistence.close();
  });

  async function site(parentSiteId: Id<'Site'> | null, of: CallContext = context) {
    const created = await useCases.createSite.execute(of, {
      parentSiteId,
      organizationId: null,
      slug: unique('s'),
      name: 'سایت',
    });
    if (!created.ok) throw new Error(`setup: ${created.error.code}`);
    return created.value.id;
  }

  /**
   * The closure rows the parent pointers imply, against the stored ones (read under the tenant's
   * own policy). Both are read in one statement, so one snapshot: other spec files create sites
   * in the same tenant fixtures in parallel, and two reads could see different trees.
   */
  async function closureMatchesParents(): Promise<void> {
    type Site = { id: string; parent_site_id: string | null; depth: number };
    type Ancestry = { ancestor_id: string; descendant_id: string; depth: number };
    const [snapshot] = await rowsOf<{ sites: Site[] | null; stored: Ancestry[] | null }>(
      `SELECT
         (SELECT json_agg(json_build_object('id', id, 'parent_site_id', parent_site_id,
            'depth', depth)) FROM tenancy.site WHERE tenant_id = $1) AS sites,
         (SELECT json_agg(json_build_object('ancestor_id', ancestor_id,
            'descendant_id', descendant_id, 'depth', depth))
            FROM tenancy.site_ancestry WHERE tenant_id = $1) AS stored`,
      [tenant.tenantId],
    );
    const sites = snapshot?.sites ?? [];
    const parent = new Map(sites.map((row) => [row.id, row.parent_site_id]));
    const expected: string[] = [];
    for (const row of sites) {
      let ancestor: string | null = row.id;
      let distance = 0;
      while (ancestor !== null) {
        expected.push(`${ancestor}>${row.id}:${distance}`);
        ancestor = parent.get(ancestor) ?? null;
        distance += 1;
      }
      expect(row.depth).toBe(distance - 1);
    }
    const stored = snapshot?.stored ?? [];
    expect(stored.map((r) => `${r.ancestor_id}>${r.descendant_id}:${r.depth}`).sort()).toEqual(
      expected.sort(),
    );
  }

  describe('the site tree', () => {
    it('creates roots and children with their closure rows, and lists a subtree', async () => {
      const root = await site(null);
      const child = await site(root);
      const grandchild = await site(child);
      const sibling = await site(root);

      const subtree = await useCases.listSites.execute(context, { rootSiteId: child });
      expect(subtree.ok && subtree.value.map((s) => s.id)).toEqual([child, grandchild]);
      const whole = await useCases.listSites.execute(context, { rootSiteId: root });
      expect(whole.ok && whole.value.map((s) => s.depth)).toEqual([0, 1, 1, 2]);
      expect(whole.ok && new Set(whole.value.map((s) => s.id))).toEqual(
        new Set([root, child, grandchild, sibling]),
      );
      await closureMatchesParents();
      expect(audit.actions()).toContain('tenancy.site.created');
    });

    it('refuses a slug in use, an unknown parent and an unknown organization, writing nothing', async () => {
      const slug = unique('dup');
      const first = await useCases.createSite.execute(context, {
        parentSiteId: null,
        organizationId: null,
        slug,
        name: 'یک',
      });
      expect(first.ok).toBe(true);
      const recorded = audit.entries.length;
      const again = await useCases.createSite.execute(context, {
        parentSiteId: null,
        organizationId: null,
        slug,
        name: 'دو',
      });
      expect(again).toEqual({ ok: false, error: { code: 'tenancy.site.slug-taken' } });
      const orphan = await useCases.createSite.execute(context, {
        parentSiteId: ids.next<'Site'>(),
        organizationId: null,
        slug: unique('o'),
        name: 'x',
      });
      expect(orphan).toEqual({ ok: false, error: { code: 'tenancy.site.not-found' } });
      const unlinked = await useCases.createSite.execute(context, {
        parentSiteId: null,
        organizationId: ids.next<'Organization'>(),
        slug: unique('o'),
        name: 'x',
      });
      expect(unlinked).toEqual({ ok: false, error: { code: 'tenancy.organization.not-found' } });
      expect(audit.entries.length).toBe(recorded);
    });

    it('refuses a site below the depth ceiling of 8 levels', async () => {
      let parent: Id<'Site'> | null = null;
      for (let level = 0; level < 8; level += 1) parent = await site(parent);
      const ninth = await useCases.createSite.execute(context, {
        parentSiteId: parent,
        organizationId: null,
        slug: unique('deep'),
        name: 'x',
      });
      expect(ninth).toEqual({ ok: false, error: { code: 'tenancy.tree.depth-exceeded' } });
    });

    it('moves a subtree, shifts its depths, rewrites the closure and is seen by the reader at once', async () => {
      const a = await site(null);
      const b = await site(a);
      const c = await site(b);
      const d = await site(null);
      expect(await useCases.reader.isWithinSubtree(context, c, a)).toBe(true);
      expect(await useCases.reader.isWithinSubtree(context, c, d)).toBe(false);

      expect(await useCases.moveSite.execute(context, { siteId: b, newParentSiteId: d })).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await useCases.reader.isWithinSubtree(context, c, a)).toBe(false);
      expect(await useCases.reader.isWithinSubtree(context, c, d)).toBe(true);
      expect(await useCases.reader.isWithinSubtree(context, d, c)).toBe(false);
      expect(await useCases.reader.isWithinSubtree(context, c, c)).toBe(false);
      await closureMatchesParents();

      expect(await useCases.moveSite.execute(context, { siteId: d, newParentSiteId: c })).toEqual({
        ok: false,
        error: { code: 'tenancy.tree.move-into-own-subtree' },
      });
      expect(
        await useCases.moveSite.execute(context, { siteId: b, newParentSiteId: null }),
      ).toEqual({
        ok: true,
        value: undefined,
      });
      const moved = await useCases.viewSite.execute(context, { siteId: c });
      expect(moved.ok && moved.value.depth).toBe(1);
      await closureMatchesParents();
      const entry = audit.entries.at(-1)!;
      expect(entry).toMatchObject({
        action: 'tenancy.site.moved',
        targetId: b,
        before: { parentSiteId: d, depth: 1 },
        after: { parentSiteId: null, depth: 0, subtreeSize: 2 },
      });
    });

    it('serialises concurrent moves per tenant, so two crossing moves never make a cycle', async () => {
      const x = await site(null);
      const y = await site(null);
      const results = await Promise.all([
        useCases.moveSite.execute(staff(tenant), { siteId: x, newParentSiteId: y }),
        useCases.moveSite.execute(staff(tenant), { siteId: y, newParentSiteId: x }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, error: { code: 'tenancy.tree.move-into-own-subtree' } },
      ]);
      await closureMatchesParents();
    });

    it('renames and links a site with optimistic versions', async () => {
      const id = await site(null);
      const org = await useCases.createOrganization.execute(context, {
        parentId: null,
        name: 'معاونت',
      });
      if (!org.ok) throw new Error('setup');
      const saved = await useCases.updateSite.execute(context, {
        siteId: id,
        version: 1,
        name: 'نام تازه',
        organizationId: org.value.id,
      });
      expect(saved.ok).toBe(true);
      const view = await useCases.viewSite.execute(context, { siteId: id });
      expect(view.ok && view.value).toMatchObject({
        name: 'نام تازه',
        organizationId: org.value.id,
        version: 2,
      });
      await expect(
        useCases.updateSite.execute(context, {
          siteId: id,
          version: 1,
          name: 'x',
          organizationId: null,
        }),
      ).rejects.toBeInstanceOf(StaleAggregateError);
    });

    it('adds, refuses a taken and removes a domain', async () => {
      const id = await site(null);
      const hostname = `${unique('h')}.example.ir`;
      const added = await useCases.addDomain.execute(context, {
        siteId: id,
        hostname: hostname.toUpperCase(),
        pathPrefix: '/',
      });
      expect(added.ok).toBe(true);
      expect(
        await useCases.addDomain.execute(context, { siteId: id, hostname, pathPrefix: '' }),
      ).toEqual({ ok: false, error: { code: 'tenancy.site-domain.taken' } });
      const withPath = await useCases.addDomain.execute(context, {
        siteId: id,
        hostname,
        pathPrefix: '/fars',
      });
      expect(withPath.ok).toBe(true);
      const view = await useCases.viewSite.execute(context, { siteId: id });
      expect(view.ok && view.value.domains.map((d) => [d.hostname, d.pathPrefix])).toEqual([
        [hostname, ''],
        [hostname, '/fars'],
      ]);
      if (!added.ok) throw new Error('setup');
      expect((await useCases.removeDomain.execute(context, { domainId: added.value.id })).ok).toBe(
        true,
      );
      expect(await useCases.removeDomain.execute(context, { domainId: added.value.id })).toEqual({
        ok: false,
        error: { code: 'tenancy.site-domain.not-found' },
      });
    });

    it("never sees, moves or answers for the other tenant's sites", async () => {
      const mine = await site(null);
      const theirs = await site(null, staff(other));
      expect(await useCases.viewSite.execute(context, { siteId: theirs })).toEqual({
        ok: false,
        error: { code: 'tenancy.site.not-found' },
      });
      expect(
        await useCases.moveSite.execute(context, { siteId: mine, newParentSiteId: theirs }),
      ).toEqual({ ok: false, error: { code: 'tenancy.site.not-found' } });
      expect(
        await useCases.createSite.execute(context, {
          parentSiteId: theirs,
          organizationId: null,
          slug: unique('x'),
          name: 'x',
        }),
      ).toEqual({ ok: false, error: { code: 'tenancy.site.not-found' } });
      const listed = await useCases.listSites.execute(context, { rootSiteId: null });
      expect(listed.ok && listed.value.some((s) => s.id === theirs)).toBe(false);
      expect(await useCases.reader.isWithinSubtree(staff(other), theirs, mine)).toBe(false);
    });
  });

  describe('the organization chart', () => {
    it('creates, renames and moves nodes, refusing a cycle', async () => {
      const create = async (parentId: Id<'Organization'> | null) => {
        const made = await useCases.createOrganization.execute(context, {
          parentId,
          name: 'اداره',
        });
        if (!made.ok) throw new Error(`setup: ${made.error.code}`);
        return made.value.id;
      };
      const ministry = await create(null);
      const deputy = await create(ministry);
      const office = await create(deputy);
      const elsewhere = await create(null);

      expect(
        await useCases.moveOrganization.execute(context, {
          organizationId: ministry,
          newParentId: office,
        }),
      ).toEqual({ ok: false, error: { code: 'tenancy.tree.move-into-own-subtree' } });
      expect(
        (
          await useCases.moveOrganization.execute(context, {
            organizationId: deputy,
            newParentId: elsewhere,
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await useCases.renameOrganization.execute(context, {
            organizationId: office,
            version: 1,
            name: 'اداره کل',
          })
        ).ok,
      ).toBe(true);
      const listed = await useCases.listOrganizations.execute(context, undefined);
      const byId = new Map(listed.ok ? listed.value.map((o) => [o.id, o]) : []);
      expect(byId.get(deputy)).toMatchObject({ parentId: elsewhere, depth: 1 });
      expect(byId.get(office)).toMatchObject({ name: 'اداره کل', depth: 2, version: 2 });

      const rows = await rowsOf<{ ancestor_id: string; depth: number }>(
        'SELECT ancestor_id, depth FROM tenancy.organization_ancestry WHERE tenant_id = $1 AND descendant_id = $2 ORDER BY depth',
        [tenant.tenantId, office],
      );
      expect(rows).toEqual([
        { ancestor_id: office, depth: 0 },
        { ancestor_id: deputy, depth: 1 },
        { ancestor_id: elsewhere, depth: 2 },
      ]);
    });
  });

  describe('the tenant settings', () => {
    it('shows the configuration with the saved settings, and saves sources and the ceiling', async () => {
      const viewed = await useCases.viewSettings.execute(context, undefined);
      if (!viewed.ok) throw new Error('setup');
      expect(viewed.value).toMatchObject({
        calendar: code === 'demo-fa' ? 'persian' : 'gregory',
        signInSources: ['local'],
        maxSiteDepth: 8,
      });

      const saved = await useCases.updateSettings.execute(context, {
        version: viewed.value.version,
        signInSources: ['local', 'directory'],
        maxSiteDepth: 12,
      });
      expect(saved.ok).toBe(true);
      const after = await useCases.viewSettings.execute(context, undefined);
      expect(after.ok && after.value).toMatchObject({
        signInSources: ['directory', 'local'],
        maxSiteDepth: 12,
        version: viewed.value.version + 1,
      });
      await expect(
        useCases.updateSettings.execute(context, {
          version: viewed.value.version,
          signInSources: ['local'],
          maxSiteDepth: 8,
        }),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      // Earlier tests built a tree 8 levels deep: a ceiling of 5 would cut it off.
      expect(
        await useCases.updateSettings.execute(context, {
          version: viewed.value.version + 1,
          signInSources: ['local'],
          maxSiteDepth: 5,
        }),
      ).toEqual({ ok: false, error: { code: 'tenancy.tenant-settings.depth-below-tree' } });
      expect(
        (
          await useCases.updateSettings.execute(context, {
            version: viewed.value.version + 1,
            signInSources: ['local'],
            maxSiteDepth: 8,
          })
        ).ok,
      ).toBe(true);
      const last = audit.entries.at(-1)!;
      expect(last).toMatchObject({
        action: 'tenancy.tenant-settings.changed',
        targetId: 'tenant',
        before: { signInSources: ['directory', 'local'], maxSiteDepth: 12 },
        after: { signInSources: ['local'], maxSiteDepth: 8 },
      });
    });
  });
});
