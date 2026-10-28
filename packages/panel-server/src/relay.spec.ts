import { apiUrlOf, readFromApi, relayToApi, type RelayOptions } from './relay';
import { config, headersOf, recordingFetch, TENANT_HOSTS } from './test-support';

const PREFIXES: RelayOptions['allowedPrefixes'] = [['identity'], ['tenancy']];

function browser(host: string, path: string, init: RequestInit & { headers?: HeadersInit } = {}) {
  const headers = new Headers(init.headers);
  headers.set('host', host);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

function ok(body: unknown = { items: [] }, headers: HeadersInit = {}) {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

describe.each(TENANT_HOSTS)('the API relay on host %s (tenant %s)', (host, tenant) => {
  it('forwards an allowed route with the tenant of its host, overriding the client', async () => {
    const api = recordingFetch(ok());
    const response = await relayToApi(
      config,
      browser(host, '/api/tenancy/sites?root=x', {
        headers: {
          cookie: '__Host-phoenix-studio=t',
          'x-tenant-id': 'someone-else',
          authorization: 'Bearer stolen',
          'x-forwarded-for': '1.2.3.4',
          accept: 'application/json',
        },
      }),
      ['tenancy', 'sites'],
      { allowedPrefixes: PREFIXES, fetch: api.fetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(api.calls).toHaveLength(1);
    const call = api.calls[0]!;
    expect(call.url).toBe('http://api.internal:3000/tenancy/sites?root=x');
    expect(call.init.redirect).toBe('manual');
    const sent = headersOf(call.init);
    expect(sent.get('x-tenant-id')).toBe(tenant);
    expect(sent.get('cookie')).toBe('__Host-phoenix-studio=t');
    expect(sent.get('accept')).toBe('application/json');
    expect(sent.get('authorization')).toBeNull();
    expect(sent.get('x-forwarded-for')).toBeNull();
    expect(sent.get('host')).toBeNull();
  });

  it('forwards a write with its body, Origin and CSRF token, and relays Set-Cookie', async () => {
    const api = recordingFetch(
      () =>
        new Response(null, {
          status: 204,
          headers: [
            ['set-cookie', '__Host-phoenix-studio=; Max-Age=0; Path=/; Secure; HttpOnly'],
            ['set-cookie', 'second=1; Path=/'],
            ['x-powered-by', 'Express'],
            ['x-correlation-id', 'c-1'],
          ],
        }),
    );
    const response = await relayToApi(
      config,
      browser(host, '/api/identity/staff/sign-out', {
        method: 'POST',
        body: JSON.stringify({ a: 1 }),
        headers: {
          'content-type': 'application/json',
          origin: `http://${host}`,
          'x-csrf-token': 'csrf',
        },
      }),
      ['identity', 'staff', 'sign-out'],
      { allowedPrefixes: PREFIXES, fetch: api.fetch },
    );
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([
      '__Host-phoenix-studio=; Max-Age=0; Path=/; Secure; HttpOnly',
      'second=1; Path=/',
    ]);
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-correlation-id')).toBe('c-1');
    const call = api.calls[0]!;
    expect(call.init.method).toBe('POST');
    expect(new TextDecoder().decode(call.init.body as Uint8Array)).toBe('{"a":1}');
    const sent = headersOf(call.init);
    expect(sent.get('origin')).toBe(`http://${host}`);
    expect(sent.get('x-csrf-token')).toBe('csrf');
    expect(sent.get('x-tenant-id')).toBe(tenant);
  });

  it.each([
    [['process', 'tasks']],
    [['health']],
    [[]],
    [['identity', '..', 'admin']],
    [['identity', '.']],
    [['identity', 'a/b']],
    [['identity', 'a%2fb']],
    [['identity', '.hidden']],
  ])('answers 404 for a route it does not relay: %p', async (segments) => {
    const api = recordingFetch(ok());
    const response = await relayToApi(config, browser(host, '/api/x'), segments, {
      allowedPrefixes: PREFIXES,
      fetch: api.fetch,
    });
    expect(response.status).toBe(404);
    expect(api.calls).toHaveLength(0);
  });

  it('answers 413 for a body over the cap, read no further', async () => {
    const api = recordingFetch(ok());
    const response = await relayToApi(
      config,
      browser(host, '/api/tenancy/sites', { method: 'POST', body: 'x'.repeat(65) }),
      ['tenancy', 'sites'],
      { allowedPrefixes: PREFIXES, maxBodyBytes: 64, fetch: api.fetch },
    );
    expect(response.status).toBe(413);
    expect(api.calls).toHaveLength(0);
  });

  it('answers 405 for a method it does not relay', async () => {
    const api = recordingFetch(ok());
    const response = await relayToApi(
      config,
      browser(host, '/api/tenancy/sites', { method: 'OPTIONS' }),
      ['tenancy', 'sites'],
      { allowedPrefixes: PREFIXES, fetch: api.fetch },
    );
    expect(response.status).toBe(405);
    expect(api.calls).toHaveLength(0);
  });

  it('never passes on a redirect, and answers 502 when the API is unreachable', async () => {
    const redirecting = recordingFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }),
    );
    const moved = await relayToApi(config, browser(host, '/api/identity/x'), ['identity', 'x'], {
      allowedPrefixes: PREFIXES,
      fetch: redirecting.fetch,
    });
    expect(moved.status).toBe(502);
    expect(moved.headers.get('location')).toBeNull();

    const down = await relayToApi(config, browser(host, '/api/identity/x'), ['identity', 'x'], {
      allowedPrefixes: PREFIXES,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ statusCode: 502, code: 'api.unavailable' });
  });

  it('reads for a server component with the browser cookie, in its tenant', async () => {
    const api = recordingFetch(ok({ accountId: 'a' }));
    const read = await readFromApi(config, { host, cookie: 'c=1' }, 'identity/staff/me', api.fetch);
    expect(read).toEqual({ ok: true, status: 200, body: { accountId: 'a' } });
    const sent = headersOf(api.calls[0]!.init);
    expect(sent.get('x-tenant-id')).toBe(tenant);
    expect(sent.get('cookie')).toBe('c=1');
    expect(api.calls[0]!.url).toBe('http://api.internal:3000/identity/staff/me');
  });

  it('reads a refusal as its status, without a body', async () => {
    const api = recordingFetch(() =>
      Response.json({ code: 'access.unauthenticated' }, { status: 401 }),
    );
    expect(
      await readFromApi(config, { host, cookie: null }, 'identity/staff/me', api.fetch),
    ).toEqual({ ok: false, status: 401, body: null });
    expect(headersOf(api.calls[0]!.init).get('cookie')).toBeNull();
  });
});

describe('the API relay on a host it does not serve', () => {
  it('answers 404 and calls nothing', async () => {
    const api = recordingFetch(ok());
    const response = await relayToApi(
      config,
      browser('evil.test', '/api/tenancy/sites'),
      ['tenancy', 'sites'],
      { allowedPrefixes: PREFIXES, fetch: api.fetch },
    );
    expect(response.status).toBe(404);
    expect(
      await readFromApi(
        config,
        { host: 'evil.test', cookie: null },
        'identity/staff/me',
        api.fetch,
      ),
    ).toEqual({ ok: false, status: 404, body: null });
    expect(api.calls).toHaveLength(0);
  });

  it('keeps every relayed URL under the API base', () => {
    expect(apiUrlOf(config, ['identity', 'me'], [['identity']])?.href).toBe(
      'http://api.internal:3000/identity/me',
    );
    expect(apiUrlOf(config, ['identity', '..'], [['identity']])).toBeNull();
    expect(apiUrlOf(config, ['identity'], [[]])).toBeNull();
  });
});
