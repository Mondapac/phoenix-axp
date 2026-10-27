// Host -> site (design doc 4.3: one portal deployment serves every site; the host decides).
// Every path is rewritten under /s/<tenant>__<site>/ so a page is cached per site (ISR). An
// unknown host answers 404: there is no default tenant or site (ADR-0002).
import { NextResponse, type NextRequest } from 'next/server';
import sitesFixture from './fixtures/sites.json';

const HOSTS = new Map(
  sitesFixture.sites.map((row) => [row.host, `${row.tenant}__${row.site}`] as const),
);

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/:\d+$/, '');
  const key = HOSTS.get(host);
  if (!key) return new NextResponse('Not found', { status: 404 });
  const url = request.nextUrl.clone();
  url.pathname = `/s/${key}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico).*)'],
};
