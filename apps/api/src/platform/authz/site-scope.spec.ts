// Phoenix ADR-0018 decisions 2 and 6: a grant covers its own site, and the sites strictly below
// it only with includeDescendants; access flows only downward. The reader here is an in-memory
// site tree per tenant; the tenancy module's reader of `site_ancestry` replaces it.
import { parseId } from '@phoenix/shared-kernel';
import type { CallContext, Id } from '@phoenix/shared-kernel';
import { testCallContext, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import { FailClosedSiteAncestryReader } from './placeholders/fail-closed-site-ancestry-reader';
import type { GrantScope } from './roles/role-model';
import { grantCoversSite, siteRelation, type SiteAncestryReader } from './site-scope';

const site = (n: number): Id<'Site'> => {
  const parsed = parseId<'Site'>(`01990000-0000-7000-8000-${String(n).padStart(12, '0')}`);
  if (!parsed.ok) throw new Error('bad id');
  return parsed.value;
};
// Per tenant: HQ > REGION > BRANCH, and HQ > OTHER_REGION.
const HQ = site(1);
const REGION = site(2);
const BRANCH = site(3);
const OTHER_REGION = site(4);
const PARENT = new Map<Id<'Site'>, Id<'Site'>>([
  [REGION, HQ],
  [BRANCH, REGION],
  [OTHER_REGION, HQ],
]);

/** A tree reader that records each question, and answers only for the tenant it holds. */
class TreeReader implements SiteAncestryReader {
  readonly asked: [string, Id<'Site'>, Id<'Site'>][] = [];
  constructor(private readonly tenant: string) {}
  siteExists(context: CallContext, siteId: Id<'Site'>): Promise<boolean> {
    return Promise.resolve(
      context.tenant.tenantId === this.tenant &&
        (PARENT.has(siteId) || [...PARENT.values()].includes(siteId)),
    );
  }
  isWithinSubtree(context: CallContext, siteId: Id<'Site'>, root: Id<'Site'>): Promise<boolean> {
    this.asked.push([context.tenant.tenantId, siteId, root]);
    if (context.tenant.tenantId !== this.tenant) return Promise.resolve(false);
    for (let at = PARENT.get(siteId); at !== undefined; at = PARENT.get(at)) {
      if (at === root) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

const grant = (siteId: Id<'Site'>, includeDescendants: boolean): GrantScope => ({
  level: 'site',
  siteId,
  includeDescendants,
});

describe.each(TEST_TENANTS)('site scope in tenant %s', (code) => {
  const context = testCallContext(testTenantContext(code), 'system');
  const reader = () => new TreeReader(code);

  describe('siteRelation', () => {
    it('answers same for the same site without asking the reader', async () => {
      const tree = reader();
      await expect(siteRelation(tree, context, REGION, REGION)).resolves.toBe('same');
      expect(tree.asked).toEqual([]);
    });

    it('answers descendant only for sites strictly below, at any depth', async () => {
      await expect(siteRelation(reader(), context, BRANCH, REGION)).resolves.toBe('descendant');
      await expect(siteRelation(reader(), context, BRANCH, HQ)).resolves.toBe('descendant');
    });

    it('answers outside for the parent and a sibling', async () => {
      await expect(siteRelation(reader(), context, HQ, REGION)).resolves.toBe('outside');
      await expect(siteRelation(reader(), context, OTHER_REGION, REGION)).resolves.toBe('outside');
    });

    it('throws when the reader throws: an unanswered question is never access', async () => {
      const broken: SiteAncestryReader = {
        siteExists: () => Promise.reject(new Error('database down')),
        isWithinSubtree: () => Promise.reject(new Error('database down')),
      };
      await expect(siteRelation(broken, context, BRANCH, REGION)).rejects.toThrow('database down');
    });
  });

  describe('grantCoversSite', () => {
    it('covers every site of the tenant under a tenant grant, and none under a platform grant', async () => {
      await expect(grantCoversSite(reader(), context, { level: 'tenant' }, BRANCH)).resolves.toBe(
        true,
      );
      await expect(grantCoversSite(reader(), context, { level: 'platform' }, BRANCH)).resolves.toBe(
        false,
      );
    });

    it('covers its own site whether or not it includes descendants', async () => {
      await expect(grantCoversSite(reader(), context, grant(REGION, false), REGION)).resolves.toBe(
        true,
      );
      await expect(grantCoversSite(reader(), context, grant(REGION, true), REGION)).resolves.toBe(
        true,
      );
    });

    it('covers a descendant only with includeDescendants, and then without asking otherwise', async () => {
      const tree = reader();
      await expect(grantCoversSite(tree, context, grant(REGION, false), BRANCH)).resolves.toBe(
        false,
      );
      expect(tree.asked).toEqual([]);
      await expect(grantCoversSite(tree, context, grant(REGION, true), BRANCH)).resolves.toBe(true);
      expect(tree.asked).toEqual([[code, BRANCH, REGION]]);
    });

    it.each([
      ['the parent', HQ],
      ['a sibling', OTHER_REGION],
    ])('never covers %s: access flows only downward', async (_case, target) => {
      await expect(grantCoversSite(reader(), context, grant(REGION, true), target)).resolves.toBe(
        false,
      );
    });

    it("asks the reader in the caller's tenant: another tenant's tree answers nothing", async () => {
      const other = TEST_TENANTS.find((tenant) => tenant !== code) ?? code;
      const foreign = new TreeReader(other);
      await expect(grantCoversSite(foreign, context, grant(REGION, true), BRANCH)).resolves.toBe(
        other === code,
      );
    });

    it('under the fail-closed placeholder, a subtree grant covers its own site only', async () => {
      const placeholder = new FailClosedSiteAncestryReader();
      await expect(
        grantCoversSite(placeholder, context, grant(REGION, true), REGION),
      ).resolves.toBe(true);
      await expect(
        grantCoversSite(placeholder, context, grant(REGION, true), BRANCH),
      ).resolves.toBe(false);
    });
  });
});
