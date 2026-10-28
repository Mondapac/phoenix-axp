import { beginSignIn, completeSignIn, isIdentityProviderUrl } from './sign-in';
import { config, headersOf, recordingFetch, TENANT_HOSTS } from './test-support';

const PAGES = { signedIn: '/', signIn: '/sign-in' };
const KEYCLOAK = 'https://sso.example.ir/realms/phoenix-x/protocol/openid-connect/auth?x=1';
const FLOW = '__Host-phoenix-flow=f; Path=/; Secure; HttpOnly; SameSite=Lax';
const SESSION = '__Host-phoenix-studio=s; Path=/; Secure; HttpOnly; SameSite=Strict';

function browser(host: string, path: string, cookie?: string) {
  const headers = new Headers({ host });
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request(`http://${host}${path}`, { headers });
}

describe.each(TENANT_HOSTS)(
  'staff sign-in through the BFF on host %s (tenant %s)',
  (host, tenant) => {
    it("relays the API's redirect to the realm with the flow cookie", async () => {
      const api = recordingFetch(
        () =>
          new Response(null, {
            status: 302,
            headers: [
              ['location', KEYCLOAK],
              ['set-cookie', FLOW],
            ],
          }),
      );
      const response = await beginSignIn(config, browser(host, '/auth/start'), {
        ...PAGES,
        fetch: api.fetch,
      });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(KEYCLOAK);
      expect(response.headers.getSetCookie()).toEqual([FLOW]);
      expect(api.calls[0]!.url).toBe('http://api.internal:3000/identity/staff/sign-in');
      expect(headersOf(api.calls[0]!.init).get('x-tenant-id')).toBe(tenant);
    });

    it.each([
      [
        'an unavailable sign-in',
        () => Response.json({ code: 'sign-in.unavailable' }, { status: 503 }),
      ],
      [
        'a redirect to a non-https URL',
        () => new Response(null, { status: 302, headers: { location: 'http://evil.test/' } }),
      ],
      [
        'a relative redirect',
        () => new Response(null, { status: 302, headers: { location: '/somewhere' } }),
      ],
    ])('sends the browser back to sign-in as unavailable on %s', async (_, answer) => {
      const api = recordingFetch(answer);
      const response = await beginSignIn(config, browser(host, '/auth/start'), {
        ...PAGES,
        fetch: api.fetch,
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/sign-in?error=unavailable');
    });

    it('forwards code and state only, with the flow cookie, and relays the session cookie', async () => {
      const api = recordingFetch(
        () =>
          new Response(JSON.stringify({ accountId: 'a', csrfToken: 'c' }), {
            status: 200,
            headers: [
              ['content-type', 'application/json'],
              ['set-cookie', '__Host-phoenix-flow=; Max-Age=0; Path=/'],
              ['set-cookie', SESSION],
            ],
          }),
      );
      const response = await completeSignIn(
        config,
        browser(
          host,
          '/auth/callback?code=c0de&state=st&session_state=x&iss=y',
          '__Host-phoenix-flow=f',
        ),
        { ...PAGES, fetch: api.fetch },
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(response.headers.getSetCookie()).toEqual([
        '__Host-phoenix-flow=; Max-Age=0; Path=/',
        SESSION,
      ]);
      // The body (the CSRF token) stays on the server: the page reads it from "me".
      expect(await response.text()).toBe('');
      const call = api.calls[0]!;
      expect(call.url).toBe(
        'http://api.internal:3000/identity/staff/sign-in/callback?code=c0de&state=st',
      );
      const sent = headersOf(call.init);
      expect(sent.get('cookie')).toBe('__Host-phoenix-flow=f');
      expect(sent.get('x-tenant-id')).toBe(tenant);
    });

    it.each([
      [400, 'refused'],
      [403, 'refused'],
      [503, 'unavailable'],
    ])(
      'answers a callback the API refuses with %s as %s, clearing the flow cookie',
      async (status, reason) => {
        const api = recordingFetch(
          () =>
            new Response('{}', {
              status,
              headers: { 'set-cookie': '__Host-phoenix-flow=; Max-Age=0; Path=/' },
            }),
        );
        const response = await completeSignIn(
          config,
          browser(host, '/auth/callback?code=x&state=y'),
          {
            ...PAGES,
            fetch: api.fetch,
          },
        );
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(`/sign-in?error=${reason}`);
        expect(response.headers.getSetCookie()).toEqual([
          '__Host-phoenix-flow=; Max-Age=0; Path=/',
        ]);
      },
    );

    it('refuses an oversized state without calling the API', async () => {
      const api = recordingFetch(() => new Response('{}'));
      const response = await completeSignIn(
        config,
        browser(host, `/auth/callback?code=x&state=${'s'.repeat(257)}`),
        { ...PAGES, fetch: api.fetch },
      );
      expect(response.headers.get('location')).toBe('/sign-in?error=refused');
      expect(api.calls).toHaveLength(0);
    });
  },
);

describe('staff sign-in on a host the panel does not serve', () => {
  it('answers 404 and calls nothing', async () => {
    const api = recordingFetch(() => new Response('{}'));
    const options = { ...PAGES, fetch: api.fetch };
    expect((await beginSignIn(config, browser('evil.test', '/auth/start'), options)).status).toBe(
      404,
    );
    expect(
      (await completeSignIn(config, browser('evil.test', '/auth/callback?code=x'), options)).status,
    ).toBe(404);
    expect(api.calls).toHaveLength(0);
  });

  it.each([
    [KEYCLOAK, true],
    ['http://localhost:8180/realms/x', true],
    ['http://127.0.0.1:8180/realms/x', true],
    ['http://sso.example.ir/realms/x', false],
    ['https://user:pw@sso.example.ir/', false],
    ['javascript:alert(1)', false],
    ['/relative', false],
  ])('follows %s to the identity provider: %s', (url, expected) => {
    expect(isIdentityProviderUrl(url)).toBe(expected);
  });
});
