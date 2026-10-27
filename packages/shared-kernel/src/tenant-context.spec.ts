import { isMinted } from './minted';
import { mintTenantContext, parseTenantId } from './tenant-context';
import type { TenantContext, TenantId } from './tenant-context';

function tenantId(text: string): TenantId {
  const result = parseTenantId(text);
  if (!result.ok) throw new Error(`test setup: bad tenant id ${text}`);
  return result.value;
}

// Two tenants, as every tenant-scoped test must cover (ADR-0002; a test that passes for one
// tenant only is a bug).
const TENANTS = ['demo-fa', 'demo-en'] as const;

describe('parseTenantId', () => {
  it.each(['demo-fa', 'demo-en', 'ab', 'tenant-2', 'a-', `a${'b'.repeat(31)}`])(
    'accepts %p',
    (text) => {
      expect(parseTenantId(text)).toEqual({ ok: true, value: text });
    },
  );

  it.each([
    ['empty', ''],
    ['one character', 'a'],
    ['thirty-three characters', `a${'b'.repeat(32)}`],
    ['upper case', 'Demo-fa'],
    ['a leading digit', '1abc'],
    ['a leading hyphen', '-abc'],
    ['an underscore', 'a_b'],
    ['a leading space', ' demo-fa'],
    ['a trailing space', 'ab '],
    ['a trailing newline', 'ab\n'],
    ['a second line', 'demo-fa\ndemo-en'],
    ['a non-ASCII letter', 'abé'],
    ['a Persian letter', 'دمو'],
    ['a list', 'demo-fa,demo-en'],
  ])('rejects %s', (_name, text) => {
    expect(parseTenantId(text)).toEqual({ ok: false, error: { code: 'tenant-id.invalid' } });
  });

  it('rejects a value that is not a string at run time (a repeated header is an array)', () => {
    expect(parseTenantId(['demo-fa'] as unknown as string).ok).toBe(false);
    expect(parseTenantId(new String('demo-fa') as unknown as string).ok).toBe(false);
    expect(parseTenantId(null as unknown as string).ok).toBe(false);
    expect(parseTenantId(undefined as unknown as string).ok).toBe(false);
  });
});

describe('mintTenantContext', () => {
  it.each(TENANTS)('builds a minted context for %s', (tenant) => {
    const context = mintTenantContext(tenantId(tenant));

    expect(context).toEqual({ tenantId: tenant });
    expect(Object.keys(context)).toEqual(['tenantId']);
    expect(Object.getOwnPropertySymbols(context)).toEqual([]);
    expect(isMinted(context)).toBe(true);
  });

  it.each(TENANTS)('freezes the context of %s', (tenant) => {
    const context = mintTenantContext(tenantId(tenant));
    const writable = context as { tenantId: string; extra?: string };

    expect(Object.isFrozen(context)).toBe(true);
    expect(() => {
      writable.tenantId = 'someone-else';
    }).toThrow(TypeError);
    expect(() => {
      writable.extra = 'x';
    }).toThrow(TypeError);
    expect(context.tenantId).toBe(tenant);
  });

  it('mints a new value every time: two contexts of one tenant are equal but not identical', () => {
    const first = mintTenantContext(tenantId('demo-fa'));
    const second = mintTenantContext(tenantId('demo-fa'));

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(isMinted(first) && isMinted(second)).toBe(true);
  });

  it('refuses an identifier that did not come from the parse function', () => {
    expect(() => mintTenantContext('Not A Tenant' as TenantId)).toThrow(TypeError);
    expect(() => mintTenantContext(undefined as unknown as TenantId)).toThrow(TypeError);
  });
});

describe('isMinted', () => {
  const minted = mintTenantContext(tenantId('demo-en'));

  it('refuses an object literal of the same shape', () => {
    // @ts-expect-error a literal lacks the brand, so it is not a TenantContext
    const literal: TenantContext = { tenantId: tenantId('demo-en') };
    const cast = { tenantId: 'demo-en' } as unknown as TenantContext;

    expect(isMinted(literal)).toBe(false);
    expect(isMinted(cast)).toBe(false);
  });

  it('refuses a spread copy of a minted context', () => {
    const copy: TenantContext = { ...minted };

    expect(copy).toEqual(minted);
    expect(isMinted(copy)).toBe(false);
  });

  it('refuses a frozen copy and an object that inherits from a minted context', () => {
    expect(isMinted(Object.freeze({ ...minted }))).toBe(false);
    expect(isMinted(Object.create(minted))).toBe(false);
  });

  it('refuses a Proxy of a minted context, which reads the same fields', () => {
    const proxy = new Proxy(minted, {});

    expect(proxy.tenantId).toBe('demo-en');
    expect(proxy).toEqual(minted);
    expect(isMinted(proxy)).toBe(false);
  });

  it('refuses a JSON round trip of a minted context', () => {
    const revived = JSON.parse(JSON.stringify(minted)) as TenantContext;

    expect(revived).toEqual(minted);
    expect(isMinted(revived)).toBe(false);
  });

  it.each([undefined, null, 'demo-en', 0, true, Symbol('x'), () => minted, [minted]])(
    'refuses %p',
    (value) => {
      expect(isMinted(value)).toBe(false);
    },
  );
});
