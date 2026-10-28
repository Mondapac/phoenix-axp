import type { ApiRead } from '@phoenix/panel-server';

// The signed-in member of a request and a page's read: which API answer sends the member to
// sign-in, to not-found, to the "no access" view, or to the error page.

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
class NotFound extends Error {}

jest.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new NotFound();
  },
}));

const answers = new Map<string, ApiRead<unknown>>();
jest.mock('./panel', () => ({
  readApi: (path: string) =>
    Promise.resolve(answers.get(path) ?? { ok: false, status: 500, body: null }),
  tenantPresentation: () => Promise.resolve(tenant),
}));

// Both tenant fixtures (config/tenants), so a branch never depends on one tenant's settings.
const TENANTS = [
  {
    displayName: 'دموی فارسی',
    defaultLocale: 'fa-IR',
    supportedLocales: ['fa-IR', 'en-US'],
    direction: 'rtl',
    calendar: 'persian',
    timeZone: 'Asia/Tehran',
  },
  {
    displayName: 'Synthetic English demo',
    defaultLocale: 'en-CA',
    supportedLocales: ['en-CA', 'fr-CA'],
    direction: 'ltr',
    calendar: 'gregory',
    timeZone: 'America/Toronto',
  },
] as const;
let tenant: (typeof TENANTS)[number] = TENANTS[0];

import { readForPage, studioSession } from './session';

const ok = <T>(body: T): ApiRead<T> => ({ ok: true, status: 200, body });
const status = (code: number): ApiRead<never> => ({ ok: false, status: code, body: null });
const ME = { accountId: 'a1', username: 'sara', csrfToken: 'c' };

describe.each(TENANTS)('studio session for $displayName', (fixture) => {
  beforeEach(() => {
    tenant = fixture;
    answers.clear();
  });

  it('answers the member, the keys they hold anywhere, the sites and the tenant’s texts', async () => {
    answers.set('identity/staff/me', ok(ME));
    answers.set(
      'identity/staff/me/permissions',
      ok({
        tenant: ['tenancy.sites.view'],
        sites: [
          { siteId: 's1', includeDescendants: true, keys: ['identity.role-assignments.manage'] },
        ],
      }),
    );
    answers.set('tenancy/sites', ok({ items: [{ id: 's1', name: 'Root', depth: 0, extra: 1 }] }));
    const session = await studioSession();
    expect(session.accountId).toBe('a1');
    expect([...session.held].sort()).toEqual([
      'identity.role-assignments.manage',
      'tenancy.sites.view',
    ]);
    expect(session.sites).toEqual([{ id: 's1', name: 'Root', depth: 0 }]);
    expect(session.t['menu.home']).toBe(
      fixture.defaultLocale === 'fa-IR' ? 'پیشخوان' : 'Dashboard',
    );
  });

  it('reads no sites without tenancy.sites.view', async () => {
    answers.set('identity/staff/me', ok(ME));
    answers.set('identity/staff/me/permissions', ok({ tenant: [], sites: [] }));
    answers.set('tenancy/sites', ok({ items: [{ id: 's1', name: 'Root', depth: 0 }] }));
    expect((await studioSession()).sites).toEqual([]);
  });

  it.each([401, 403])('sends a member whose session is gone (%i) to sign-in', async (code) => {
    answers.set('identity/staff/me', status(code));
    await expect(studioSession()).rejects.toEqual(new Redirect('/sign-in'));
  });

  it('answers not-found for a host whose tenant the API does not know', async () => {
    answers.set('identity/staff/me', status(404));
    await expect(studioSession()).rejects.toBeInstanceOf(NotFound);
  });

  it('treats a failed permissions read as an error, not as a sign-in', async () => {
    answers.set('identity/staff/me', ok(ME));
    answers.set('identity/staff/me/permissions', status(503));
    await expect(studioSession()).rejects.toThrow('answered 503');
  });
});

describe('readForPage', () => {
  beforeEach(() => answers.clear());

  it('answers the body of a 200', async () => {
    answers.set('identity/roles', ok({ items: [] }));
    await expect(readForPage('identity/roles')).resolves.toEqual({ items: [] });
  });

  it('answers null when the API refuses the member (the page shows no access)', async () => {
    answers.set('identity/roles', status(403));
    await expect(readForPage('identity/roles')).resolves.toBeNull();
  });

  it('is not-found for a 404, sign-in for a 401, and an error for anything else', async () => {
    answers.set('a', status(404));
    answers.set('b', status(401));
    answers.set('c', status(502));
    await expect(readForPage('a')).rejects.toBeInstanceOf(NotFound);
    await expect(readForPage('b')).rejects.toEqual(new Redirect('/sign-in'));
    await expect(readForPage('c')).rejects.toThrow('c answered 502');
  });
});
