import { describeAuditAction } from '@phoenix/shared-kernel';
import { TENANCY_AUDIT_ACTIONS } from './audit-actions';
import { DEFAULT_TENANT_SETTINGS, parseMaxSiteDepth, parseSignInSources } from './tenant-settings';
import { childDepth, planMove } from './tree';
import { parseHostname, parseName, parsePathPrefix, parseSlug } from './values';

describe('tenancy values', () => {
  it.each(['fars', 'fars-2', 'a', 'x'.repeat(64)])('accepts the slug %s', (slug) => {
    expect(parseSlug(slug)).toEqual({ ok: true, value: slug });
  });

  it.each(['', 'Fars', 'fars_2', '-fars', 'fars-', 'fa--rs', 'فارس', 'x'.repeat(65)])(
    'refuses the slug "%s"',
    (slug) => {
      expect(parseSlug(slug)).toEqual({
        ok: false,
        error: { code: 'tenancy.value.invalid', field: 'slug' },
      });
    },
  );

  it('trims a name and refuses an empty, overlong or control-character one', () => {
    expect(parseName('  اداره کل فارس ')).toEqual({ ok: true, value: 'اداره کل فارس' });
    for (const name of ['', '   ', 'x'.repeat(201), 'a\u0000b', 'a\nb']) {
      expect(parseName(name).ok).toBe(false);
    }
  });

  it('lower-cases a host name and refuses a port, a single label or a non-ASCII host', () => {
    expect(parseHostname('Fars.Example.IR')).toEqual({ ok: true, value: 'fars.example.ir' });
    expect(parseHostname('xn--mgba3a4f16a.ir').ok).toBe(true);
    for (const host of ['localhost', 'a.example.ir:443', 'فارس.ir', '-a.ir', 'a..ir', 'a.ir.']) {
      expect(parseHostname(host).ok).toBe(false);
    }
  });

  it('stores the whole host as "" and refuses a trailing slash or upper case', () => {
    expect(parsePathPrefix('/')).toEqual({ ok: true, value: '' });
    expect(parsePathPrefix('')).toEqual({ ok: true, value: '' });
    expect(parsePathPrefix('/provinces/fars')).toEqual({ ok: true, value: '/provinces/fars' });
    for (const prefix of ['fars', '/fars/', '/Fars', '//fars', '/fa rs']) {
      expect(parsePathPrefix(prefix).ok).toBe(false);
    }
  });
});

describe('the tree rules (ADR-0018 decision 2)', () => {
  it('places a root at depth 0 and a child one below its parent, under the ceiling', () => {
    expect(childDepth(null, 8)).toEqual({ ok: true, value: 0 });
    expect(childDepth(6, 8)).toEqual({ ok: true, value: 7 });
    expect(childDepth(7, 8)).toEqual({
      ok: false,
      error: { code: 'tenancy.tree.depth-exceeded' },
    });
    expect(childDepth(null, 1)).toEqual({ ok: true, value: 0 });
  });

  it('refuses a move under the node itself or its subtree', () => {
    expect(
      planMove({
        depth: 1,
        subtreeHeight: 2,
        newParent: { depth: 3, withinSubtree: true },
        maxDepth: 8,
      }),
    ).toEqual({ ok: false, error: { code: 'tenancy.tree.move-into-own-subtree' } });
  });

  it('shifts the subtree by the difference of depths, and keeps its deepest node under the ceiling', () => {
    expect(
      planMove({
        depth: 3,
        subtreeHeight: 2,
        newParent: { depth: 0, withinSubtree: false },
        maxDepth: 8,
      }),
    ).toEqual({ ok: true, value: { depth: 1, depthShift: -2 } });
    expect(planMove({ depth: 2, subtreeHeight: 1, newParent: null, maxDepth: 8 })).toEqual({
      ok: true,
      value: { depth: 0, depthShift: -2 },
    });
    // New depth 6, plus a subtree of height 2: depth 8 is past a ceiling of 8 levels (0 to 7).
    expect(
      planMove({
        depth: 1,
        subtreeHeight: 2,
        newParent: { depth: 5, withinSubtree: false },
        maxDepth: 8,
      }),
    ).toEqual({ ok: false, error: { code: 'tenancy.tree.depth-exceeded' } });
    expect(
      planMove({
        depth: 1,
        subtreeHeight: 1,
        newParent: { depth: 5, withinSubtree: false },
        maxDepth: 8,
      }),
    ).toEqual({ ok: true, value: { depth: 6, depthShift: 5 } });
  });
});

describe('tenant settings (ADR-0019)', () => {
  it('defaults to local accounts and a ceiling of 8 levels', () => {
    expect(DEFAULT_TENANT_SETTINGS).toEqual({
      signInSources: ['local'],
      maxSiteDepth: 8,
      version: 1,
    });
  });

  it('accepts one or both sign-in sources, in a fixed order', () => {
    expect(parseSignInSources(['local', 'directory'])).toEqual({
      ok: true,
      value: ['directory', 'local'],
    });
    for (const sources of [[], ['local', 'local'], ['google'], ['directory', 'local', 'x']]) {
      expect(parseSignInSources(sources)).toEqual({
        ok: false,
        error: { code: 'tenancy.value.invalid', field: 'signInSources' },
      });
    }
  });

  it('takes a ceiling from 1 to 32', () => {
    expect(parseMaxSiteDepth(1).ok).toBe(true);
    expect(parseMaxSiteDepth(32).ok).toBe(true);
    for (const depth of [0, 33, 2.5, Number.NaN]) expect(parseMaxSiteDepth(depth).ok).toBe(false);
  });
});

describe('the tenancy audit actions (ADR-0015 decision 2)', () => {
  it('are owned by tenancy and carry no free-text field', () => {
    for (const definition of TENANCY_AUDIT_ACTIONS) {
      expect(definition.owner).toBe('tenancy');
      const { before, after } = describeAuditAction(definition);
      const kinds = [...Object.values(before ?? {}), ...Object.values(after ?? {})];
      for (const kind of kinds) expect(kind).toMatch(/^(optional\(id\)|id|integer|boolean|listOf)/);
    }
  });
});
