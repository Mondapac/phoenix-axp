import { TENANTS } from '../test-tenants';
import { directionOf, formatNumber, htmlAttributes, toLocaleDigits } from './locale';

describe.each(TENANTS)('locale helpers for tenant $code', (tenant) => {
  it('derives the direction the tenant declares from its default locale', () => {
    expect(directionOf(tenant.defaultLocale)).toBe(tenant.direction);
  });

  it('gives <html> the locale, its direction and the theme class', () => {
    expect(htmlAttributes(tenant.defaultLocale)).toEqual({
      lang: tenant.defaultLocale,
      dir: tenant.direction,
    });
    expect(htmlAttributes(tenant.defaultLocale, 'dark').className).toBe('dark');
  });

  it('formats numbers and digits in the locale and leaves values for another locale alone', () => {
    const formatted = formatNumber(1234, tenant.defaultLocale);
    expect(formatted).toBe(new Intl.NumberFormat(tenant.defaultLocale).format(1234));
    expect(toLocaleDigits('2026-10', tenant.defaultLocale)).toBe(
      tenant.direction === 'rtl' ? '۲۰۲۶-۱۰' : '2026-10',
    );
  });

  it('gives every supported locale a direction', () => {
    for (const locale of tenant.supportedLocales)
      expect(['ltr', 'rtl']).toContain(directionOf(locale));
  });
});

describe('directionOf for languages added later in the admin panel', () => {
  it.each([
    ['ar', 'rtl'],
    ['he-IL', 'rtl'],
    ['ur-PK', 'rtl'],
    ['ckb', 'rtl'],
    ['az-Arab', 'rtl'],
    ['az-Latn', 'ltr'],
    ['de-DE', 'ltr'],
    ['zh-Hans', 'ltr'],
  ])('%s is %s', (locale, direction) => {
    expect(directionOf(locale)).toBe(direction);
  });

  it('falls back to ltr for a tag that is not a locale', () => {
    expect(directionOf('not a locale!')).toBe('ltr');
  });
});
