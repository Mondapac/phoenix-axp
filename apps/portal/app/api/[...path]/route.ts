import { relayToApi } from '@phoenix/panel-server';
import { PORTAL_API_PREFIXES, portalConfig, relayedRequest } from '../../_server/panel';

// The portal's relay to the core API: `/api/<route>` forwards an allow-listed route in the
// tenant of the host (packages/panel-server). The browser calls nothing else.

interface Context {
  readonly params: Promise<{ readonly path: string[] }>;
}

async function relay(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return relayToApi(portalConfig(), relayedRequest(request, path), path, {
    allowedPrefixes: PORTAL_API_PREFIXES,
  });
}

export const POST = relay;
export const dynamic = 'force-dynamic';
