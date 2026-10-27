// SPIKE (PoC 1, slice 0.6, owner addition; ADR-0018): one tenant with 500 sites in a tree, the
// closure table site_ancestry, and role grants scoped to a site with includeDescendants.
// Proves access flows only downward, through the production path (UnitOfWork + guard + RLS).
import { ok } from '@phoenix/shared-kernel';
import type { Client } from 'pg';
import { anyGrantCoversSite, grantCoversSite, type AncestorDepths } from '../../src/modules/site';
import {
  APP_URL,
  MINISTRY,
  OWNER_URL,
  connect,
  createSpikePersistence,
  seedId,
  tenantOf,
  timeMs,
  writeResult,
  type SpikePersistence,
} from './poc1-support';

const ministry = tenantOf(MINISTRY);
const results: Record<string, unknown> = {};
const site = (n: number): string => seedId(`ministry/site/${n}`);

interface Tree {
  readonly ids: string[];
  readonly parent: Map<string, string | null>;
}

/** Truth from the parent pointers alone: is `ancestor` a proper ancestor of `node`? */
function isProperAncestor(tree: Tree, ancestor: string, node: string): boolean {
  for (
    let current = tree.parent.get(node) ?? null;
    current !== null;
    current = tree.parent.get(current) ?? null
  ) {
    if (current === ancestor) return true;
  }
  return false;
}

describe('PoC 1: 500-site tree, subtree role scope under RLS', () => {
  let persistence: SpikePersistence;
  let owner: Client;
  let app: Client;

  beforeAll(async () => {
    persistence = createSpikePersistence(APP_URL);
    owner = await connect(OWNER_URL);
    app = await connect(APP_URL);
  });
  afterAll(async () => {
    writeResult('site-tree', results);
    await app.end();
    await owner.end();
    await persistence.close();
  });

  async function loadTree(): Promise<Tree> {
    const result = await persistence.unitOfWork.run(
      ministry,
      async () =>
        ok(
          await persistence.service.tx(ministry).site.findMany({
            where: { tenantId: MINISTRY },
            select: { id: true, parentSiteId: true },
          }),
        ),
      { readOnly: true },
    );
    if (!result.ok) throw new Error('unreachable');
    return {
      ids: result.value.map((row) => row.id),
      parent: new Map(result.value.map((row) => [row.id, row.parentSiteId])),
    };
  }

  async function ancestorsOf(tenantCode: string, target: string): Promise<AncestorDepths> {
    const tenant = tenantOf(tenantCode);
    const result = await persistence.unitOfWork.run(
      tenant,
      async () =>
        ok(
          await persistence.service.tx(tenant).siteAncestry.findMany({
            where: { tenantId: tenantCode, descendantId: target },
            select: { ancestorId: true, depth: true },
          }),
        ),
      { readOnly: true },
    );
    if (!result.ok) throw new Error('unreachable');
    return new Map(result.value.map((row) => [row.ancestorId, row.depth]));
  }

  /** Every (grant site, target site) pair, both scopes, against the parent-pointer truth. */
  async function exhaustiveCheck(tree: Tree) {
    const tally = {
      pairs: 0,
      mismatches: 0,
      self: 0,
      downAllowed: 0,
      downDeniedThisSite: 0,
      upDenied: 0,
      sidewaysDenied: 0,
    };
    for (const target of tree.ids) {
      const ancestors = await ancestorsOf(MINISTRY, target);
      for (const grantSite of tree.ids) {
        for (const includeDescendants of [false, true]) {
          tally.pairs += 1;
          const allowed = grantCoversSite({ siteId: grantSite, includeDescendants }, ancestors);
          const below = isProperAncestor(tree, grantSite, target);
          const above = isProperAncestor(tree, target, grantSite);
          const expected = grantSite === target || (includeDescendants && below);
          if (allowed !== expected) tally.mismatches += 1;
          if (grantSite === target) tally.self += 1;
          else if (below) {
            if (allowed) tally.downAllowed += 1;
            else tally.downDeniedThisSite += 1;
          } else if (above) tally.upDenied += allowed ? 0 : 1;
          else tally.sidewaysDenied += allowed ? 0 : 1;
        }
      }
    }
    return tally;
  }

  it('the tree has 500 sites, depth up to 8, and the closure table matches the parent pointers', async () => {
    const { rows: shape } = await owner.query<{
      sites: string;
      max_depth: number;
      ancestry: string;
    }>(
      `SELECT (SELECT count(*) FROM site.site WHERE tenant_id = 'ministry') AS sites,
              (SELECT max(depth) FROM site.site WHERE tenant_id = 'ministry') AS max_depth,
              (SELECT count(*) FROM site.site_ancestry WHERE tenant_id = 'ministry') AS ancestry`,
    );
    const { rows: diff } = await owner.query<{ n: string }>(`
      WITH RECURSIVE truth AS (
        SELECT id AS descendant_id, id AS ancestor_id, parent_site_id AS next_id, 0 AS depth
          FROM site.site WHERE tenant_id = 'ministry'
        UNION ALL
        SELECT t.descendant_id, p.id, p.parent_site_id, t.depth + 1
          FROM truth t JOIN site.site p ON p.tenant_id = 'ministry' AND p.id = t.next_id)
      SELECT count(*) AS n FROM (
        (SELECT ancestor_id, descendant_id, depth FROM truth
         EXCEPT SELECT ancestor_id, descendant_id, depth FROM site.site_ancestry WHERE tenant_id = 'ministry')
        UNION ALL
        (SELECT ancestor_id, descendant_id, depth FROM site.site_ancestry WHERE tenant_id = 'ministry'
         EXCEPT SELECT ancestor_id, descendant_id, depth FROM truth)) d`);
    results.shape = { ...shape[0], closureDifferences: Number(diff[0]!.n) };
    expect(Number(shape[0]!.sites)).toBe(500);
    expect(shape[0]!.max_depth).toBe(8);
    expect(Number(diff[0]!.n)).toBe(0);
  });

  it('exhaustive: 500 x 500 x {thisSite, includeDescendants} decisions, only downward', async () => {
    const tree = await loadTree();
    expect(tree.ids).toHaveLength(500);
    const tally = await exhaustiveCheck(tree);
    results.exhaustive = tally;
    expect(tally.pairs).toBe(500 * 500 * 2);
    expect(tally.mismatches).toBe(0);
  });

  it('named cases: down allowed, up and sideways denied, thisSite stays on its site', async () => {
    const province1 = site(11);
    const county = site(42); // province-1-county-1
    const countyOffice = site(340); // under county 42
    const sibling = site(43); // province-1-county-2
    const otherProvince = site(12);
    const chainLeaf = site(444); // depth 8
    const grant = (siteId: string, includeDescendants: boolean) => ({ siteId, includeDescendants });
    const at = async (target: string) => ancestorsOf(MINISTRY, target);
    const cases = {
      'province grant + descendants -> its county office (down 2)': grantCoversSite(
        grant(province1, true),
        await at(countyOffice),
      ),
      'root grant + descendants -> depth-8 leaf': grantCoversSite(
        grant(site(0), true),
        await at(chainLeaf),
      ),
      'county grant + descendants -> its province (up)': grantCoversSite(
        grant(county, true),
        await at(province1),
      ),
      'county grant + descendants -> the root (up)': grantCoversSite(
        grant(county, true),
        await at(site(0)),
      ),
      'county grant + descendants -> sibling county (sideways)': grantCoversSite(
        grant(county, true),
        await at(sibling),
      ),
      'county grant + descendants -> other province (sideways)': grantCoversSite(
        grant(county, true),
        await at(otherProvince),
      ),
      'province grant thisSite -> its county (down, not included)': grantCoversSite(
        grant(province1, false),
        await at(county),
      ),
      'province grant thisSite -> itself': grantCoversSite(
        grant(province1, false),
        await at(province1),
      ),
    };
    results.namedCases = cases;
    expect(Object.values(cases)).toEqual([true, true, false, false, false, false, false, true]);
  });

  it('across tenants: nothing resolves, tenant-wide grants included', async () => {
    const otherTenantSite = seedId('t0001/site/0');
    const fromMinistry = await ancestorsOf(MINISTRY, otherTenantSite);
    const fromOther = await ancestorsOf('t0001', site(0));
    const cases = {
      ministryUnitSeesAncestorsOfOtherTenantSite: fromMinistry.size,
      otherTenantUnitSeesAncestorsOfMinistrySite: fromOther.size,
      tenantWideGrantCoversOtherTenantSite: anyGrantCoversSite(
        [{ siteId: null, includeDescendants: true }],
        fromMinistry,
      ),
      rootGrantCoversOtherTenantSite: anyGrantCoversSite(
        [{ siteId: site(0), includeDescendants: true }],
        fromMinistry,
      ),
    };
    results.crossTenant = cases;
    expect(cases).toEqual({
      ministryUnitSeesAncestorsOfOtherTenantSite: 0,
      otherTenantUnitSeesAncestorsOfMinistrySite: 0,
      tenantWideGrantCoversOtherTenantSite: false,
      rootGrantCoversOtherTenantSite: false,
    });
  });

  it('moving a subtree recomputes access from the new tree (ADR-0018 decision 6)', async () => {
    // Move province-1 (site 11, with 8 counties and their offices) under deputy-1 (site 1),
    // as the app login under RLS, with the standard closure-table move in one transaction.
    const move = async (node: string, newParent: string) => {
      await app.query('BEGIN');
      try {
        await app.query("SELECT pg_catalog.set_config('app.tenant_id', 'ministry', true)");
        // Refuse a cycle: the new parent may not be inside the moved subtree.
        const cycle = await app.query(
          'SELECT 1 FROM site.site_ancestry WHERE tenant_id = $1 AND ancestor_id = $2 AND descendant_id = $3',
          [MINISTRY, node, newParent],
        );
        if (cycle.rowCount !== 0) throw new Error('cycle');
        await app.query(
          `DELETE FROM site.site_ancestry a
            USING site.site_ancestry sub, site.site_ancestry sup
            WHERE sub.tenant_id = $1 AND sub.ancestor_id = $2
              AND sup.tenant_id = $1 AND sup.descendant_id = $2 AND sup.depth > 0
              AND a.tenant_id = $1 AND a.descendant_id = sub.descendant_id AND a.ancestor_id = sup.ancestor_id`,
          [MINISTRY, node],
        );
        await app.query(
          `INSERT INTO site.site_ancestry (tenant_id, ancestor_id, descendant_id, depth)
           SELECT $1::varchar, sup.ancestor_id, sub.descendant_id, sup.depth + sub.depth + 1
             FROM site.site_ancestry sup, site.site_ancestry sub
            WHERE sup.tenant_id = $1 AND sup.descendant_id = $3
              AND sub.tenant_id = $1 AND sub.ancestor_id = $2`,
          [MINISTRY, node, newParent],
        );
        await app.query(
          'UPDATE site.site SET parent_site_id = $3, depth = (SELECT depth + 1 FROM site.site WHERE tenant_id = $1 AND id = $3) WHERE tenant_id = $1 AND id = $2',
          [MINISTRY, node, newParent],
        );
        // Depths of the moved descendants follow their closure depth to the root.
        await app.query(
          `UPDATE site.site s SET depth = a.depth FROM site.site_ancestry a
            WHERE s.tenant_id = $1 AND a.tenant_id = $1 AND a.descendant_id = s.id
              AND a.ancestor_id = $3
              AND s.id IN (SELECT descendant_id FROM site.site_ancestry WHERE tenant_id = $1 AND ancestor_id = $2)`,
          [MINISTRY, node, site(0)],
        );
        await app.query('COMMIT');
      } catch (error) {
        await app.query('ROLLBACK');
        throw error;
      }
    };
    const province1 = site(11);
    const countyOffice = site(340);
    const deputy1 = site(1);
    const before = grantCoversSite(
      { siteId: deputy1, includeDescendants: true },
      await ancestorsOf(MINISTRY, countyOffice),
    );
    const moveMs = await timeMs(() => move(province1, deputy1));
    const after = grantCoversSite(
      { siteId: deputy1, includeDescendants: true },
      await ancestorsOf(MINISTRY, countyOffice),
    );
    const tally = await exhaustiveCheck(await loadTree());
    const cycleRefused = await move(deputy1, countyOffice).then(
      () => false,
      () => true,
    );
    const backMs = await timeMs(() => move(province1, site(0)));
    const restored = grantCoversSite(
      { siteId: deputy1, includeDescendants: true },
      await ancestorsOf(MINISTRY, countyOffice),
    );
    results.move = {
      before,
      after,
      restored,
      moveMs,
      backMs,
      cycleRefused,
      exhaustiveAfterMove: tally,
    };
    expect([before, after, restored]).toEqual([false, true, false]);
    expect(cycleRefused).toBe(true);
    expect(tally.mismatches).toBe(0);
  });
});
