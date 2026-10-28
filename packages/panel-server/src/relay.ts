import { tenantOfHost, type PanelServerConfig } from './config';

// The BFF's relay to the core API (ADR-0001; ADR-0004 decision 2). The browser talks to its
// panel's origin only; the panel's server forwards an allow-listed API route with the tenant of
// its own host in `x-tenant-id` (whatever the client sent is dropped), the browser's session
// cookie, Origin and CSRF token, and relays the answer and its `Set-Cookie`. It holds no
// business logic and decides nothing: the API authenticates and authorises every request.

/** Request headers the relay forwards; every other one, `x-tenant-id` included, is dropped. */
const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'origin',
  'x-csrf-token',
] as const;

/** Response headers the relay passes back, besides `Set-Cookie`. */
const RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-correlation-id'] as const;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const API_TIMEOUT_MS = 15_000;
/** The default cap of a relayed request body. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** How a panel relays: the first path segments it lets through, and the body cap. */
export interface RelayOptions {
  /** Path prefixes the panel's screens need, as segments (`[['identity'], ['tenancy']]`). */
  readonly allowedPrefixes: readonly (readonly string[])[];
  readonly maxBodyBytes?: number;
  readonly fetch?: typeof fetch;
}

/** A JSON answer of the BFF itself, in the API's error shape. */
export function bffAnswer(status: number, code: string): Response {
  return Response.json(
    { statusCode: status, code },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * The API URL of `segments` under the configured base, or null when a segment could leave the
 * route (`.`, `..`, an encoded slash) or the route is not allow-listed.
 */
export function apiUrlOf(
  config: PanelServerConfig,
  segments: readonly string[],
  allowedPrefixes: readonly (readonly string[])[],
): URL | null {
  if (segments.length === 0 || !segments.every((s) => SEGMENT.test(s) && s !== '..')) {
    return null;
  }
  const allowed = allowedPrefixes.some(
    (prefix) => prefix.length > 0 && prefix.every((part, index) => segments[index] === part),
  );
  if (!allowed) return null;
  const url = new URL(segments.join('/'), config.apiUrl);
  return url.origin === config.apiUrl.origin && url.pathname.startsWith(config.apiUrl.pathname)
    ? url
    : null;
}

/** The headers of a call to the API in `tenant`, from the allow-listed request headers. */
export function apiHeaders(tenant: string, from?: Headers): Headers {
  const headers = new Headers();
  if (from !== undefined) {
    for (const name of REQUEST_HEADERS) {
      const value = from.get(name);
      if (value !== null) headers.set(name, value);
    }
  }
  headers.set('x-tenant-id', tenant);
  return headers;
}

/** Copies the allow-listed response headers and every `Set-Cookie` of `from`. */
export function relayedHeaders(from: Headers): Headers {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of RESPONSE_HEADERS) {
    const value = from.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const cookie of from.getSetCookie()) headers.append('set-cookie', cookie);
  return headers;
}

/**
 * Relays the browser's `request` to the API route `segments` (the panel's catch-all route
 * `/api/[...path]`). Answers 404 for a host the panel does not serve or a route it does not
 * relay, 405 for another method, 413 for a body over the cap, and 502 when the API cannot be
 * reached or answers a redirect, which the relay never follows or passes on.
 */
export async function relayToApi(
  config: PanelServerConfig,
  request: Request,
  segments: readonly string[],
  options: RelayOptions,
): Promise<Response> {
  const tenant = tenantOfHost(config, request.headers.get('host'));
  if (tenant === null) return bffAnswer(404, 'not-found');
  if (!METHODS.has(request.method)) return bffAnswer(405, 'method.not-allowed');
  const url = apiUrlOf(config, segments, options.allowedPrefixes);
  if (url === null) return bffAnswer(404, 'not-found');
  url.search = new URL(request.url).search;

  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.method !== 'GET') {
    const read = await readCapped(request, options.maxBodyBytes ?? MAX_BODY_BYTES);
    if (read === null) return bffAnswer(413, 'request.too-large');
    body = read;
  }

  let answer: Response;
  try {
    answer = await (options.fetch ?? fetch)(url, {
      method: request.method,
      headers: apiHeaders(tenant, request.headers),
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    return bffAnswer(502, 'api.unavailable');
  }
  if (answer.status >= 300 && answer.status < 400) {
    await answer.body?.cancel();
    return bffAnswer(502, 'api.unavailable');
  }
  return new Response(answer.status === 204 ? null : answer.body, {
    status: answer.status,
    headers: relayedHeaders(answer.headers),
  });
}

/** The body of `request`, or null once it passes `max` bytes (read no further). */
async function readCapped(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isSafeInteger(declared) || declared > max) return null;
  if (request.body === null) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/** The answer of {@link readFromApi}: the status, and the JSON body of a 2xx answer. */
export type ApiRead<T> =
  { readonly status: 200; readonly body: T } | { readonly status: number; readonly body: null };

/**
 * A GET of the API from the panel's own server (a server component reading what a page
 * shows), in the tenant of `host`, with the browser's cookies. `path` is the panel's own
 * constant, never input. Throws when the API cannot be reached, so the page shows its error
 * state; a host the panel does not serve answers 404.
 */
export async function readFromApi<T>(
  config: PanelServerConfig,
  incoming: { readonly host: string | null; readonly cookie: string | null },
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiRead<T>> {
  const tenant = tenantOfHost(config, incoming.host);
  if (tenant === null) return { status: 404, body: null };
  const [route, query] = path.split('?', 2);
  const url = apiUrlOf(config, (route ?? '').split('/'), [[(route ?? '').split('/')[0] ?? '']]);
  if (url === null) throw new Error(`Not an API path: ${path}`);
  if (query !== undefined) url.search = query;
  const headers = apiHeaders(tenant);
  headers.set('accept', 'application/json');
  if (incoming.cookie !== null) headers.set('cookie', incoming.cookie);
  const answer = await fetchImpl(url, {
    headers,
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (answer.status !== 200) {
    await answer.body?.cancel();
    return { status: answer.status, body: null };
  }
  return { status: 200, body: (await answer.json()) as T };
}
