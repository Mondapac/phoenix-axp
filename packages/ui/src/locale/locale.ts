// Locale helpers for the panels (ADR-0008, ADR-0016 decision 4). The UI is multilingual: the
// languages a tenant offers are tenant configuration, set in the admin panel, so nothing here
// names a language. Direction, digits and number formats are derived from the locale tag itself.

export type Direction = 'ltr' | 'rtl';

// Scripts written right to left (ISO 15924), for runtimes without Intl.Locale text info.
const RTL_SCRIPTS = new Set([
  'Adlm',
  'Arab',
  'Aran',
  'Hebr',
  'Mand',
  'Mend',
  'Nkoo',
  'Rohg',
  'Samr',
  'Syrc',
  'Thaa',
  'Yezi',
]);

type LocaleWithTextInfo = Intl.Locale & {
  getTextInfo?: () => { direction?: string };
  textInfo?: { direction?: string };
};

/** The writing direction of a locale tag, from its (likely) script. */
export function directionOf(locale: string): Direction {
  let parsed: LocaleWithTextInfo;
  try {
    parsed = new Intl.Locale(locale);
  } catch {
    return 'ltr';
  }
  const info = parsed.getTextInfo?.() ?? parsed.textInfo;
  if (info?.direction === 'rtl' || info?.direction === 'ltr') return info.direction;
  const script = parsed.maximize().script;
  return script !== undefined && RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
}

/**
 * The attributes the server puts on <html> for a resolved locale (ADR-0016 decision 4: nothing
 * switches direction in the browser). `theme` adds `light` or `dark`; "system" adds no class, and
 * tokens.css follows the operating system.
 */
export function htmlAttributes(
  locale: string,
  theme: 'light' | 'dark' | 'system' = 'system',
): { lang: string; dir: Direction; className?: string } {
  return {
    lang: locale,
    dir: directionOf(locale),
    ...(theme === 'system' ? {} : { className: theme }),
  };
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A number in the locale's digits and grouping (fa: ۱٬۲۳۴, en: 1,234). */
export function formatNumber(value: number, locale: string): string {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

const ZERO_OF: Record<string, number> = { arabext: 0x06f0, arab: 0x0660 };

/** The numbering system a locale displays digits in ('latn', 'arabext', 'arab', ...). */
export function numberingSystemOf(locale: string): string {
  return new Intl.NumberFormat(locale).resolvedOptions().numberingSystem;
}

/** ASCII digits in a string shown in the locale's own digits (display only; values stay ASCII). */
export function toLocaleDigits(value: string, locale: string): string {
  const zero = ZERO_OF[numberingSystemOf(locale)];
  if (zero === undefined) return value;
  return value.replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0x30 + zero));
}
