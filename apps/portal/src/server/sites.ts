// Host -> tenant and site, with locale, calendar and zone (design doc 4.1 step 2; ADR-0008
// decision 2: the tenant's values are defaults a site may override). In the product this is the
// BFF asking the API; the spike reads fixture JSON and the checked-in tenant files.
import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sitesFixture from '../../fixtures/sites.json';

const REPO = path.resolve(process.cwd(), '../..');
export const FIXTURES = path.resolve(process.cwd(), 'fixtures');

interface TenantConfig {
  code: string;
  defaultLocale: string;
  supportedLocales: string[];
  timeZone: string;
  calendar: string;
}

export interface SiteRow {
  host: string;
  tenant: string;
  site: string;
  parent: string | null;
  locale?: string;
  calendar?: string;
  timeZone?: string;
}

export interface Site {
  key: string;
  tenant: string;
  site: string;
  /** Root first, this site last; all in the same tenant. */
  chain: string[];
  locale: string;
  calendar: string;
  timeZone: string;
  dir: 'rtl' | 'ltr';
}

const rows = sitesFixture.sites as SiteRow[];

/** The URL segment that names a site after the proxy rewrite: `<tenant>__<site>`. */
export const siteKey = (row: Pick<SiteRow, 'tenant' | 'site'>) => `${row.tenant}__${row.site}`;

export const allSiteKeys = () => rows.map(siteKey);

function tenantConfig(code: string): TenantConfig {
  // The tenant id is checked against the fixture list before it reaches a path.
  if (!rows.some((row) => row.tenant === code)) throw new Error('unknown tenant');
  return JSON.parse(
    readFileSync(path.join(REPO, 'config/tenants', `${code}.json`), 'utf8'),
  ) as TenantConfig;
}

/** Text direction from the locale itself (Intl Locale text info), never from a language list. */
export function directionOf(locale: string): 'rtl' | 'ltr' {
  const info = new Intl.Locale(locale) as Intl.Locale & {
    getTextInfo?: () => { direction: string };
    textInfo?: { direction: string };
  };
  const direction = info.getTextInfo?.().direction ?? info.textInfo?.direction;
  return direction === 'rtl' ? 'rtl' : 'ltr';
}

export function getSite(key: string): Site | null {
  const row = rows.find((candidate) => siteKey(candidate) === key);
  if (!row) return null;
  const chain: SiteRow[] = [row];
  for (let parent = row.parent; parent !== null;) {
    const up = rows.find((r) => r.tenant === row.tenant && r.site === parent);
    if (!up || chain.length > 8) throw new Error('broken site tree');
    chain.unshift(up);
    parent = up.parent;
  }
  const tenant = tenantConfig(row.tenant);
  // The nearest site that sets a value wins; otherwise the tenant default.
  const pick = <K extends 'locale' | 'calendar' | 'timeZone'>(key: K) =>
    [...chain].reverse().find((r) => r[key] !== undefined)?.[key];
  const locale = pick('locale') ?? tenant.defaultLocale;
  return {
    key,
    tenant: row.tenant,
    site: row.site,
    chain: chain.map((r) => r.site),
    locale,
    calendar: pick('calendar') ?? tenant.calendar,
    timeZone: pick('timeZone') ?? tenant.timeZone,
    dir: directionOf(locale),
  };
}

/** The proxy's map: request host (no port) -> site key. */
export const hostMap = (): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.host, siteKey(row)]));
