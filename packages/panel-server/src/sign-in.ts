import { tenantOfHost, type PanelServerConfig } from './config';
import { apiHeaders, apiUrlOf, bffAnswer, relayedHeaders } from './relay';

// Staff sign-in through the BFF (ADR-0004 decisions 1 and 2). The API runs the OIDC flow; the
// BFF only carries it: `begin` relays the API's redirect to Keycloak with the flow cookie, and
// `complete` (the callback URL registered on the Keycloak client) forwards `code` and `state`
// with that cookie, relays the session cookie and sends the browser on. Neither reads a token.

/** Where the panel sends the browser after a sign-in, and after a refused one. */
export interface SignInOptions {
  readonly signedIn: string;
  /** The sign-in page; `?error=unavailable` or `?error=refused` is appended. */
  readonly signIn: string;
  readonly fetch?: typeof fetch;
}

const API_TIMEOUT_MS = 15_000;
const CALLBACK_PARAMETER_MAX = { code: 4096, state: 256 } as const;

function redirect(location: string, headers = new Headers({ 'cache-control': 'no-store' })) {
  headers.set('location', location);
  return new Response(null, { status: 303, headers });
}

async function callApi(url: URL, tenant: string, from: Headers, fetchImpl: typeof fetch) {
  try {
    return await fetchImpl(url, {
      headers: apiHeaders(tenant, from),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

/**
 * The panel's sign-in start (`GET /auth/start`): the API's 302 to the tenant's realm, with its
 * flow cookie. Only an absolute https URL, or http on a loopback host for development, is
 * followed; anything else sends the browser back to the sign-in page as unavailable.
 */
export async function beginSignIn(
  config: PanelServerConfig,
  request: Request,
  options: SignInOptions,
): Promise<Response> {
  const tenant = tenantOfHost(config, request.headers.get('host'));
  if (tenant === null) return bffAnswer(404, 'not-found');
  const url = apiUrlOf(config, ['identity', 'staff', 'sign-in'], [['identity', 'staff']]);
  const answer =
    url === null ? null : await callApi(url, tenant, request.headers, options.fetch ?? fetch);
  const location = answer?.status === 302 ? answer.headers.get('location') : null;
  await answer?.body?.cancel();
  if (answer === null || location === null || !isIdentityProviderUrl(location)) {
    return redirect(`${options.signIn}?error=unavailable`);
  }
  const headers = relayedHeaders(answer.headers);
  headers.delete('content-type');
  headers.set('location', location);
  return new Response(null, { status: 302, headers });
}

/** An absolute https URL, or http on a loopback host (a development Keycloak). */
export function isIdentityProviderUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/**
 * The panel's sign-in callback (`GET /auth/callback?code&state`): forwards `code` and `state`
 * only, with the browser's cookies, relays every `Set-Cookie` (the session cookie, and the
 * cleared flow cookie) and sends the browser to the signed-in page, or back to sign-in.
 */
export async function completeSignIn(
  config: PanelServerConfig,
  request: Request,
  options: SignInOptions,
): Promise<Response> {
  const tenant = tenantOfHost(config, request.headers.get('host'));
  if (tenant === null) return bffAnswer(404, 'not-found');
  const incoming = new URL(request.url).searchParams;
  const url = apiUrlOf(
    config,
    ['identity', 'staff', 'sign-in', 'callback'],
    [['identity', 'staff']],
  );
  if (url === null) return redirect(`${options.signIn}?error=unavailable`);
  for (const name of ['code', 'state'] as const) {
    const value = incoming.get(name) ?? '';
    if (value.length > CALLBACK_PARAMETER_MAX[name]) {
      return redirect(`${options.signIn}?error=refused`);
    }
    url.searchParams.set(name, value);
  }
  const answer = await callApi(url, tenant, request.headers, options.fetch ?? fetch);
  if (answer === null) return redirect(`${options.signIn}?error=unavailable`);
  await answer.body?.cancel();
  const headers = relayedHeaders(answer.headers);
  headers.delete('content-type');
  if (answer.status === 200 || answer.status === 201) return redirect(options.signedIn, headers);
  const reason = answer.status === 503 || answer.status >= 500 ? 'unavailable' : 'refused';
  return redirect(`${options.signIn}?error=${reason}`, headers);
}
