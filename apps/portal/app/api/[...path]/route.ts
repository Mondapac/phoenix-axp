import { relayToApi } from '@phoenix/panel-server';
import {
  ANONYMOUS_API_PREFIXES,
  PORTAL_API_PREFIXES,
  portalConfig,
  startsWithAny,
} from '../../_server/panel';

// The portal's relay to the core API: `/api/<route>` forwards an allow-listed route in the
// tenant of the host (packages/panel-server). The browser calls nothing else.

interface Context {
  readonly params: Promise<{ readonly path: string[] }>;
}

async function relay(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  let forwarded = request;
  if (startsWithAny(path, ANONYMOUS_API_PREFIXES)) {
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    forwarded = new Request(request, { headers });
  }
  return relayToApi(portalConfig(), forwarded, path, { allowedPrefixes: PORTAL_API_PREFIXES });
}

export const POST = relay;
export const dynamic = 'force-dynamic';
