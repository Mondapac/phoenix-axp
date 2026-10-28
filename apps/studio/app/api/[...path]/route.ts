import { relayToApi } from '@phoenix/panel-server';
import { STUDIO_API_PREFIXES, studioConfig } from '../../_server/panel';

// The studio's relay to the core API: `/api/<route>` forwards an allow-listed route in the
// tenant of the host (packages/panel-server). The browser calls nothing else.

interface Context {
  readonly params: Promise<{ readonly path: string[] }>;
}

async function relay(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return relayToApi(studioConfig(), request, path, { allowedPrefixes: STUDIO_API_PREFIXES });
}

export const GET = relay;
export const POST = relay;
export const PUT = relay;
export const PATCH = relay;
export const DELETE = relay;
export const dynamic = 'force-dynamic';
