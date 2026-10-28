import {
  ancestorsOf,
  childrenOf,
  domainAddress,
  hostnameOf,
  indentOf,
  isId,
  isSiteName,
  isSlug,
  moveTargets,
  organizationNode,
  pathPrefixOf,
  siteNode,
  subtreeIds,
  treeOrder,
  type OrganizationNode,
  type SiteNode,
} from './structure';

// The two tenant fixtures' languages (config/tenants: demo-fa and demo-en).
const TENANTS = [
  { name: 'demo-fa', locale: 'fa-IR' },
  { name: 'demo-en', locale: 'en-CA' },
] as const;

const site = (id: string, parentSiteId: string | null, name: string, depth: number): SiteNode => ({
  id,
  parentSiteId,
  organizationId: null,
  slug: id,
  name,
  depth,
  version: 1,
});

// The API's order: by depth, then name.
const SITES: SiteNode[] = [
  site('r2', null, 'Zeta', 0),
  site('r1', null, 'Alpha', 0),
  site('a', 'r1', 'Beta', 1),
  site('b', 'r2', 'Alpha child', 1),
  site('c', 'r1', 'Aardvark', 1),
  site('d', 'a', 'Gamma', 2),
];

describe.each(TENANTS)('structure rules ($name)', ({ locale }) => {
  it('orders a depth-sorted list as a tree, siblings by name', () => {
    expect(treeOrder(SITES, siteNode, locale).map((s) => s.id)).toEqual([
      'r1',
      'c',
      'a',
      'd',
      'r2',
      'b',
    ]);
  });

  it('starts a tree at a node whose parent is not listed (a subtree read)', () => {
    const subtree = SITES.filter((s) => ['a', 'd'].includes(s.id));
    expect(treeOrder(subtree, siteNode, locale).map((s) => s.id)).toEqual(['a', 'd']);
  });

  it('sorts Persian names in the tenant collation', () => {
    const units: OrganizationNode[] = [
      { id: '2', parentId: null, name: 'معاونت', depth: 0, version: 1 },
      { id: '1', parentId: null, name: 'اداره', depth: 0, version: 1 },
    ];
    expect(treeOrder(units, organizationNode, locale).map((u) => u.id)).toEqual(['1', '2']);
  });
});

describe('tree queries', () => {
  it('finds a subtree whatever the list order', () => {
    const reversed = [...SITES].reverse();
    expect([...subtreeIds(reversed, siteNode, 'r1')].sort()).toEqual(['a', 'c', 'd', 'r1']);
    expect([...subtreeIds(SITES, siteNode, 'd')]).toEqual(['d']);
  });

  it('offers as move targets only the nodes outside the own subtree', () => {
    expect(moveTargets(SITES, siteNode, 'a').map((s) => s.id)).toEqual(['r2', 'r1', 'b', 'c']);
  });

  it('lists children and ancestors', () => {
    expect(childrenOf(SITES, siteNode, 'r1').map((s) => s.id)).toEqual(['a', 'c']);
    expect(ancestorsOf(SITES, siteNode, 'd').map((s) => s.id)).toEqual(['r1', 'a']);
    expect(ancestorsOf(SITES, siteNode, 'r1')).toEqual([]);
    expect(ancestorsOf(SITES, siteNode, 'missing')).toEqual([]);
  });

  it('stops at a cycle instead of looping', () => {
    const cycle = [site('x', 'y', 'X', 1), site('y', 'x', 'Y', 1)];
    expect(ancestorsOf(cycle, siteNode, 'x').map((s) => s.id)).toEqual(['y']);
  });
});

describe('value rules (as the tenancy API)', () => {
  it('accepts a slug of lower-case letters and digits joined by single hyphens', () => {
    expect(isSlug('ministry-hq')).toBe(true);
    expect(isSlug('a1')).toBe(true);
    for (const bad of ['', 'Upper', 'two--hyphens', '-start', 'end-', 'فارسی', 'a'.repeat(65)]) {
      expect(isSlug(bad)).toBe(false);
    }
  });

  it('accepts a name of 1 to 200 characters with no control characters', () => {
    expect(isSiteName('  وزارت  ')).toBe(true);
    expect(isSiteName('   ')).toBe(false);
    expect(isSiteName('a\u0007b')).toBe(false);
    expect(isSiteName('ن'.repeat(201))).toBe(false);
  });

  it('lower-cases a host name and refuses one the API would refuse', () => {
    expect(hostnameOf(' Portal.Example.IR ')).toBe('portal.example.ir');
    expect(hostnameOf('xn--mgbh0fb.ir')).toBe('xn--mgbh0fb.ir');
    for (const bad of ['localhost', 'a..b', '-a.ir', 'host.ir:8080', 'وزارت.ir']) {
      expect(hostnameOf(bad)).toBeNull();
    }
  });

  it('stores "/" as the whole host and refuses a trailing slash', () => {
    expect(pathPrefixOf('')).toBe('');
    expect(pathPrefixOf('/')).toBe('');
    expect(pathPrefixOf('/news/fa')).toBe('/news/fa');
    for (const bad of ['news', '/news/', '/News', '/a//b']) expect(pathPrefixOf(bad)).toBeNull();
  });

  it('reads a domain as host and path, and caps the indent', () => {
    expect(domainAddress({ hostname: 'a.ir', pathPrefix: '' })).toBe('a.ir');
    expect(domainAddress({ hostname: 'a.ir', pathPrefix: '/x' })).toBe('a.ir/x');
    expect(indentOf(-1)).toBe(0);
    expect(indentOf(3)).toBe(3);
    expect(indentOf(20)).toBe(8);
  });

  it('takes only a UUID as a path id', () => {
    expect(isId('0190a000-0000-7000-8000-000000000001')).toBe(true);
    for (const bad of ['', '..', 'a b', '0190a000-0000-7000-8000-00000000000']) {
      expect(isId(bad)).toBe(false);
    }
  });
});
