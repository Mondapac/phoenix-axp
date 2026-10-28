import { beginSignIn } from '@phoenix/panel-server';
import { SIGN_IN_PAGES, studioConfig } from '../../_server/panel';

/** Starts staff sign-in: the tenant's Keycloak realm, by way of the API. */
export function GET(request: Request): Promise<Response> {
  return beginSignIn(studioConfig(), request, SIGN_IN_PAGES);
}

export const dynamic = 'force-dynamic';
