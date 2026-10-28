import { completeSignIn } from '@phoenix/panel-server';
import { SIGN_IN_PAGES, studioConfig } from '../../_server/panel';

/** Keycloak's redirect back (STUDIO_SIGN_IN_CALLBACK_URL): the session, then the dashboard. */
export function GET(request: Request): Promise<Response> {
  return completeSignIn(studioConfig(), request, SIGN_IN_PAGES);
}

export const dynamic = 'force-dynamic';
