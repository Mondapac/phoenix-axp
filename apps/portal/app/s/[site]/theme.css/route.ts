import { themeStylesheet } from '@phoenix/ui';
import { siteTheme } from '../../../../src/server/content.ts';
import { allSiteKeys, getSite } from '../../../../src/server/sites.ts';

export const dynamic = 'force-static';
export const generateStaticParams = () => allSiteKeys().map((site) => ({ site }));

/** The site's resolved theme tokens (inherited down the site tree, locks applied). */
export async function GET(_request: Request, { params }: { params: Promise<{ site: string }> }) {
  const site = getSite((await params).site);
  if (!site) return new Response('Not found', { status: 404 });
  const theme = siteTheme(site);
  const notes = theme.refused.map((r) => `/* refused ${r.token} from ${r.siteId}: ${r.reason} */`);
  return new Response(`${notes.join('\n')}\n${themeStylesheet(theme)}`, {
    headers: { 'content-type': 'text/css; charset=utf-8' },
  });
}
