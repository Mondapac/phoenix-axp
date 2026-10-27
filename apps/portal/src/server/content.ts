// Published content for a site, read from fixtures in place of the content delivery API.
// A published page version is immutable (design doc 3, ADR-0007 V1): the pointer file names the
// live version and the version file is never edited; a publish adds a file and moves the pointer.
import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PageData } from '@phoenix/ui/blocks';
import { resolveTheme, type ResolvedTheme, type SiteTheme } from '@phoenix/ui';
import platformDefault from '@phoenix/ui/platform-default.json';
import { FIXTURES, type Site } from './sites.ts';

const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

export function publishedPage(site: Site, slug: string): (PageData & { _version: unknown }) | null {
  if (!SLUG.test(slug)) return null;
  const dir = path.join(FIXTURES, 'pages', site.tenant, site.site);
  const pointer = path.join(dir, 'published.json');
  if (!existsSync(pointer)) return null;
  const version = readJson<Record<string, number>>(pointer)[slug];
  if (!Number.isInteger(version)) return null;
  return readJson(path.join(dir, `${slug}@${version}.json`));
}

export function siteTheme(site: Site): ResolvedTheme {
  const chain = site.chain.map((id) => {
    const file = path.join(FIXTURES, 'themes', site.tenant, `${id}.json`);
    return existsSync(file) ? readJson<SiteTheme>(file) : { siteId: id, tokens: {} };
  });
  return resolveTheme([platformDefault, ...chain]);
}

export interface FormRevision {
  _revision: { form: string; revision: number };
  schema: Record<string, unknown> & { properties?: Record<string, unknown> };
  uischema: Record<string, unknown>;
  messages: Record<string, Record<string, string>>;
}

/** A form defined at this site or an ancestor (ADR-0018 decision 5: usable in the subtree). */
export function siteForm(site: Site, slug: string): { form: FormRevision; owner: string } | null {
  if (!SLUG.test(slug)) return null;
  for (const owner of [...site.chain].reverse()) {
    const file = path.join(FIXTURES, 'forms', site.tenant, owner, `${slug}.json`);
    if (existsSync(file)) return { form: readJson<FormRevision>(file), owner };
  }
  return null;
}
