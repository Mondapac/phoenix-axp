// SPIKE (PoC 2, slice 0.7): hybrid login. Keycloak (LDAP federation + local staff accounts)
// answers "who are you" by OIDC Authorization Code + PKCE; the core keeps an opaque session in
// PostgreSQL (SHA-256 of the token only), with no session or permission cache, and authorises
// in the use case. Needs spike/poc-2/setup.sh (LDAP, Keycloak realms, phoenix_poc2).
import { CORE, KEYCLOAK, POC2_APP_URL, POC2_OWNER_URL } from './poc2-env';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCorrelationId, uuidV7 } from '@phoenix/shared-kernel';
import { createCallContext, systemActor } from '@phoenix/shared-kernel/contexts';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import type { Client } from 'pg';
import { SyncStaffAccountsWithIdp } from '../../src/modules/identity/application/use-cases/staff-admin.use-cases';
import { createTestApp, type TestApp } from '../support/test-app';
import { Browser } from './poc2-browser';
import { REPO_ROOT, connect, seedId, stats, timeMs } from './poc1-support';

const results: Record<string, unknown> = {};
const site = (tenant: string, slug: string) => seedId(`${tenant}/site/${slug}`);
const FA = 'demo-fa';
const EN = 'demo-en';
const content = (tenant: string, slug: string) =>
  `/spike/studio/sites/${site(tenant, slug)}/content`;
const newId = () => uuidV7(Date.now(), new Uint8Array(randomBytes(10)));

async function masterToken(): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: 'admin-secret',
    }),
  });
  return ((await response.json()) as { access_token: string }).access_token;
}

/** The Keycloak console, as a realm administrator would use it (out of band of the core). */
async function keycloakConsole(
  method: string,
  realmPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${KEYCLOAK}/admin/realms/${realmPath}`, {
    method,
    headers: { authorization: `Bearer ${await masterToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : null };
}

async function keycloakUserId(tenant: string, username: string): Promise<string> {
  const { json } = await keycloakConsole(
    'GET',
    `phoenix-${tenant}/users?username=${username}&exact=true`,
  );
  const users = json as Array<{ id: string }>;
  if (users.length !== 1) throw new Error(`no Keycloak user ${username}`);
  return users[0]!.id;
}

/** The directory administrator disables (or re-enables) an account in LDAP. */
function ldapSetStatus(uid: string, status: 'active' | 'disabled'): void {
  execFileSync(
    'ldapmodify',
    [
      '-x',
      '-H',
      'ldap://127.0.0.1:10389',
      '-D',
      'cn=admin,dc=phoenix,dc=test',
      '-w',
      'admin-secret',
    ],
    {
      input: `dn: uid=${uid},ou=people,dc=phoenix,dc=test\nchangetype: modify\nreplace: employeeType\nemployeeType: ${status}\n`,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

function writeResults(): void {
  // UNIT_TENANT_SESSION=adapter runs the whole spec on PoC 1's design-change candidate.
  const name =
    process.env.UNIT_TENANT_SESSION === 'adapter' ? 'hybrid-login-adapter-session' : 'hybrid-login';
  writeFileSync(
    path.join(REPO_ROOT, `spike/poc-2/results/${name}.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

describe('PoC 2: hybrid login (Keycloak + LDAP + local staff, core sessions, use-case gate)', () => {
  let testApp: TestApp;
  let owner: Client;
  const accounts: Record<string, { id: string; subject: string }> = {};
  const grants: Record<string, string> = {};
  const browsers: Record<string, Browser> = {};
  let syncAs: (tenant: string) => Promise<unknown>;

  beforeAll(async () => {
    // Fresh realms and directory state, so the spec can run again.
    execFileSync('node', [path.join(REPO_ROOT, 'spike/poc-2/keycloak/setup-realms.mjs')], {
      stdio: 'ignore',
    });
    for (const uid of ['alice', 'dariush', 'nima']) ldapSetStatus(uid, 'active');
    owner = await connect(POC2_OWNER_URL);
    await owner.query(
      'DELETE FROM identity.role_grant; DELETE FROM identity.staff_session; DELETE FROM identity.staff_account',
    );

    // Staff accounts as studio would have created or linked them (ADR-0019): two directory
    // employees, two local ones in demo-fa; one local one in demo-en (local only).
    const people: Array<[string, string, 'directory' | 'local']> = [
      [FA, 'alice', 'directory'],
      [FA, 'dariush', 'directory'],
      [FA, 'bahar', 'local'],
      [FA, 'sara', 'local'],
      [EN, 'emma', 'local'],
    ];
    for (const [tenant, username, source] of people) {
      const subject = await keycloakUserId(tenant, username);
      const id = newId();
      accounts[username] = { id, subject };
      await owner.query(
        `INSERT INTO identity.staff_account (id, tenant_id, subject, username, source, status, version, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', 1, now())`,
        [id, tenant, subject, username, source],
      );
    }
    const grant = async (
      name: string,
      username: string,
      tenant: string,
      role: string,
      siteSlug: string | null,
      includeDescendants: boolean,
    ) => {
      const id = newId();
      grants[name] = id;
      await owner.query(
        `INSERT INTO identity.role_grant (id, tenant_id, principal_id, role_id, site_id, include_descendants, created_at)
         VALUES ($1, $2::varchar, $3, md5($2::text || '/role/' || $4::text)::uuid, $5, $6, now())`,
        [
          id,
          tenant,
          accounts[username]!.id,
          role,
          siteSlug === null ? null : site(tenant, siteSlug),
          includeDescendants,
        ],
      );
    };
    // The same role, the same scope, for a directory employee and a local one.
    await grant('alice-editor', 'alice', FA, 'editor', 'province-1', true);
    await grant('bahar-editor', 'bahar', FA, 'editor', 'province-1', true);
    await grant('dariush-editor', 'dariush', FA, 'editor', 'root', true);
    await grant('sara-admin', 'sara', FA, 'staff-admin', null, false);
    await grant('emma-editor', 'emma', EN, 'editor', 'root', true);

    testApp = await createTestApp({ env: { DATABASE_URL: POC2_APP_URL, LOG_LEVEL: 'warn' } });
    await testApp.app.listen(Number(new URL(CORE).port), '127.0.0.1');
    const sync = testApp.app.get(SyncStaffAccountsWithIdp);
    syncAs = async (tenantId) => {
      const tenant = testTenantContext(tenantId);
      const correlation = parseCorrelationId(`sync-${Date.now()}`);
      if (!correlation.ok) throw new Error('correlation');
      return sync.execute(
        createCallContext(tenant, systemActor(tenant), correlation.value),
        undefined,
      );
    };
  });

  afterAll(async () => {
    writeResults();
    await testApp?.app.close();
    await owner?.end();
  });

  it('signs in a directory (LDAP) employee and a local employee by Authorization Code + PKCE', async () => {
    const outcome: Record<string, unknown> = {};
    for (const [username, tenant] of [
      ['alice', FA],
      ['bahar', FA],
      ['sara', FA],
      ['dariush', FA],
      ['emma', EN],
    ] as const) {
      const browser = new Browser(tenant);
      const page = await browser.signIn(username, `${username}-pass`);
      outcome[username] = { status: page.status, body: page.json };
      expect(page.status).toBe(200);
      expect(page.json).toEqual({ signedIn: true, accountId: accounts[username]!.id });
      browsers[username] = browser;
    }
    results.signIn = outcome;
  });

  it('stores only the SHA-256 of the session token, nothing a stolen row could replay', async () => {
    const token = browsers.alice!.cookie('__Host-phoenix-studio')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await owner.query<{
      token_hash: Buffer;
      idp_session_id: string | null;
      row_text: string;
    }>(
      `SELECT token_hash, idp_session_id, s::text AS row_text FROM identity.staff_session s WHERE account_id = $1`,
      [accounts.alice!.id],
    );
    const expected = createHash('sha256').update(token).digest();
    results.sessionStorage = {
      rows: rows.length,
      hashBytes: rows[0]!.token_hash.length,
      hashMatches: rows[0]!.token_hash.equals(expected),
      rawTokenInRow: rows[0]!.row_text.includes(token),
      idpSessionIdStored: rows[0]!.idp_session_id !== null,
    };
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.equals(expected)).toBe(true);
    expect(rows[0]!.row_text.includes(token)).toBe(false);
    // Presenting the hash instead of the token is refused.
    const forged = new Browser(FA);
    forged.setCookie('__Host-phoenix-studio', rows[0]!.token_hash.toString('base64url'));
    expect(await forged.get(content(FA, 'county-1'))).toBe(401);
  });

  it('Keycloak refuses an authorisation request without PKCE (client requires S256)', async () => {
    const url = new URL(`${KEYCLOAK}/realms/phoenix-${FA}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: 'phoenix-studio',
      redirect_uri: `${CORE}/spike/auth/callback`,
      scope: 'openid',
      state: 's',
    }).toString();
    const response = await fetch(url, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';
    const refused =
      location.includes('error=invalid_request') && location.includes('code_challenge');
    results.pkceRequired = { status: response.status, refused };
    expect(refused).toBe(true);
  });

  it('a directory employee and a local employee reach the same use case through the same rules', async () => {
    const matrix: Record<string, Record<string, number>> = {};
    for (const username of ['alice', 'bahar']) {
      const b = browsers[username]!;
      matrix[username] = {
        'county-1 (below the grant)': await b.get(content(FA, 'county-1')),
        'province-1 (the grant site)': await b.get(content(FA, 'province-1')),
        'province-2 (sideways)': await b.get(content(FA, 'province-2')),
        'root (upward)': await b.get(content(FA, 'root')),
        'unknown site': await b.get(`/spike/studio/sites/${newId()}/content`),
      };
    }
    matrix.emma = {
      'branch (demo-en, below the grant)': await browsers.emma!.get(content(EN, 'branch')),
    };
    matrix.anonymous = { 'county-1': await new Browser(FA).get(content(FA, 'county-1')) };
    // A session of one tenant presented to another tenant's panel is unknown there.
    matrix.crossTenant = {
      'alice cookie, demo-en header': await browsers.alice!.get(content(EN, 'branch'), EN),
    };
    results.sameRules = matrix;
    expect(matrix.alice).toEqual(matrix.bahar);
    expect(matrix.alice).toEqual({
      'county-1 (below the grant)': 200,
      'province-1 (the grant site)': 200,
      'province-2 (sideways)': 404,
      'root (upward)': 404,
      'unknown site': 404,
    });
    expect(matrix.emma).toEqual({ 'branch (demo-en, below the grant)': 200 });
    expect(matrix.anonymous).toEqual({ 'county-1': 401 });
    expect(matrix.crossTenant).toEqual({ 'alice cookie, demo-en header': 401 });
  });

  it('criterion 1: revoking a role takes effect on the very next request (under load)', async () => {
    const alice = browsers.alice!;
    expect(await alice.get(content(FA, 'county-1'))).toBe(200);
    // Alice keeps requesting while Sara revokes her grant; every request that starts after the
    // revoke has answered must be refused.
    let revokedAt: bigint | null = null;
    const samples: Array<{ startedAt: bigint; status: number }> = [];
    let stop = false;
    const load = (async () => {
      while (!stop) {
        const startedAt = process.hrtime.bigint();
        samples.push({ startedAt, status: await alice.get(content(FA, 'county-1')) });
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const revoke = await browsers.sara!.post(
      `/spike/studio/role-grants/${grants['alice-editor']}/revoke`,
    );
    revokedAt = process.hrtime.bigint();
    await new Promise((resolve) => setTimeout(resolve, 300));
    stop = true;
    await load;
    const next = await alice.get(content(FA, 'county-1'));
    const after = samples.filter((s) => s.startedAt > revokedAt);
    const before = samples.filter((s) => s.startedAt <= revokedAt);
    results.revokeRole = {
      revokeResponse: revoke,
      requestsBeforeRevoke: before.length,
      allowedBeforeRevoke: before.filter((s) => s.status === 200).length,
      requestsStartedAfterRevokeAnswered: after.length,
      allowedAfterRevoke: after.filter((s) => s.status === 200).length,
      nextRequestStatus: next,
    };
    expect(revoke.status).toBe(200);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((s) => s.status === 200)).toHaveLength(0);
    expect(next).toBe(403);
    // Bahar, with the same role at the same site, is untouched.
    expect(await browsers.bahar!.get(content(FA, 'county-1'))).toBe(200);
  });

  it('criterion 2: disabling the user in LDAP takes effect on the next request after the sync', async () => {
    const dariush = browsers.dariush!;
    expect(await dariush.get(content(FA, 'county-1'))).toBe(200);
    const sessionsBefore = await owner.query(
      'SELECT 1 FROM identity.staff_session WHERE account_id = $1',
      [accounts.dariush!.id],
    );
    ldapSetStatus('dariush', 'disabled');
    const disabledAt = Date.now();
    // Before the core hears of it: the core session is still valid (Keycloak sends nothing by
    // itself for a directory change).
    const beforeSync = await dariush.get(content(FA, 'county-1'));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const sessionsAfterWait = await owner.query(
      'SELECT 1 FROM identity.staff_session WHERE account_id = $1',
      [accounts.dariush!.id],
    );
    // Keycloak itself no longer signs the user in.
    const relogin = await new Browser(FA).signIn('dariush', 'dariush-pass');
    const keycloakRefusesLogin =
      relogin.status === 200 &&
      relogin.json === null &&
      /Invalid username or password|invalid/i.test(relogin.body);
    // The sync job (worker, system actor).
    let syncReport: unknown;
    const syncMs = await timeMs(async () => {
      syncReport = await syncAs(FA);
    });
    const next = await dariush.get(content(FA, 'county-1'));
    const { rows } = await owner.query<{ status: string }>(
      'SELECT status FROM identity.staff_account WHERE id = $1',
      [accounts.dariush!.id],
    );
    results.ldapDisable = {
      coreSessionsBefore: sessionsBefore.rowCount,
      requestBeforeSync: beforeSync,
      coreSessionsOneSecondAfterLdapChange: sessionsAfterWait.rowCount,
      keycloakRefusesNewLogin: keycloakRefusesLogin,
      syncReport,
      syncMs,
      msFromLdapChangeToNextRequestRefused: Date.now() - disabledAt,
      nextRequestAfterSync: next,
      accountStatus: rows[0]!.status,
    };
    expect(keycloakRefusesLogin).toBe(true);
    expect(next).toBe(401);
    expect(rows[0]!.status).toBe('disabled');
  });

  it('criterion 3: disabling a local account takes effect on the very next request', async () => {
    const bahar = browsers.bahar!;
    expect(await bahar.get(content(FA, 'county-1'))).toBe(200);
    const disable = await browsers.sara!.post(
      `/spike/studio/staff-accounts/${accounts.bahar!.id}/disable`,
    );
    const next = await bahar.get(content(FA, 'county-1'));
    const { json: kcUser } = await keycloakConsole(
      'GET',
      `phoenix-${FA}/users/${accounts.bahar!.subject}`,
    );
    const relogin = await new Browser(FA).signIn('bahar', 'bahar-pass');
    // A directory account cannot be disabled from studio: AD owns it (ADR-0019).
    const directoryRefused = await browsers.sara!.post(
      `/spike/studio/staff-accounts/${accounts.alice!.id}/disable`,
    );
    // A staff member without the permission cannot disable anyone.
    const emmaTries = await browsers.alice!.post(
      `/spike/studio/staff-accounts/${accounts.sara!.id}/disable`,
    );
    results.localDisable = {
      disableResponse: disable,
      nextRequest: next,
      keycloakUserEnabled: (kcUser as { enabled: boolean }).enabled,
      keycloakRefusesNewLogin: relogin.json === null && /disabled|Invalid/i.test(relogin.body),
      disableDirectoryAccountFromStudio: directoryRefused,
      disableWithoutPermission: emmaTries,
    };
    expect(disable.status).toBe(200);
    expect(disable.json).toMatchObject({ idpDisabled: true });
    expect(next).toBe(401);
    expect((kcUser as { enabled: boolean }).enabled).toBe(false);
    expect(directoryRefused.status).toBe(409);
    expect(emmaTries.status).toBe(403);
  });

  it('back-channel logout: Keycloak ends the SSO session, the core session ends with it', async () => {
    const emma = browsers.emma!;
    expect(await emma.get(content(EN, 'branch'))).toBe(200);
    // A realm administrator signs Emma out in the Keycloak console.
    const logout = await keycloakConsole(
      'POST',
      `phoenix-${EN}/users/${accounts.emma!.subject}/logout`,
    );
    const next = await emma.get(content(EN, 'branch'));
    // Sign in again, then the administrator disables her in the Keycloak console (not studio).
    const again = new Browser(EN);
    expect((await again.signIn('emma', 'emma-pass')).status).toBe(200);
    expect(await again.get(content(EN, 'branch'))).toBe(200);
    await keycloakConsole('PUT', `phoenix-${EN}/users/${accounts.emma!.subject}`, {
      enabled: false,
    });
    const afterConsoleDisable = await again.get(content(EN, 'branch'));
    const syncReport = await syncAs(EN);
    const afterSync = await again.get(content(EN, 'branch'));
    // A forged or foreign logout token is refused and ends nothing.
    const forged = await fetch(`${CORE}/spike/backchannel/${FA}/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        logout_token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln',
      }).toString(),
    });
    results.backchannel = {
      consoleLogoutStatus: logout.status,
      nextRequestAfterConsoleLogout: next,
      nextRequestAfterConsoleDisable: afterConsoleDisable,
      syncReport,
      nextRequestAfterSync: afterSync,
      forgedLogoutTokenStatus: forged.status,
    };
    expect(next).toBe(401);
    expect(afterSync).toBe(401);
    expect(forged.status).toBe(400);
  });

  it('first sign-in of a directory employee creates an account without roles; an unknown local user is refused', async () => {
    const nima = new Browser(FA);
    const page = await nima.signIn('nima', 'nima-pass');
    const studio = await nima.get(content(FA, 'county-1'));
    const lena = await new Browser(FA).signIn('lena', 'lena-pass');
    const { rows } = await owner.query<{ source: string }>(
      "SELECT source FROM identity.staff_account WHERE username = 'nima'",
    );
    results.provisioning = {
      nimaSignIn: page.status,
      nimaSource: rows[0]?.source,
      nimaStudio: studio,
      lenaSignIn: lena.status,
      lenaBody: lena.json,
    };
    expect(page.status).toBe(200);
    expect(rows[0]?.source).toBe('directory');
    expect(studio).toBe(403);
    expect(lena.status).toBe(403);
  });

  it('cost of reading session and permissions on every request (no cache)', async () => {
    const sara = browsers.sara!;
    const anonymous = new Browser(FA);
    const authenticated: number[] = [];
    const refused: number[] = [];
    for (let i = 0; i < 50; i += 1) await sara.get(content(FA, 'county-1'));
    for (let i = 0; i < 400; i += 1) {
      authenticated.push(await timeMs(() => sara.get(content(FA, 'county-1'))));
      refused.push(await timeMs(() => anonymous.get(content(FA, 'county-1'))));
    }
    results.perRequestCost = {
      authenticatedListSiteContent: stats(authenticated),
      anonymousRefusedAtGate: stats(refused),
      unitsPerAuthenticatedRequest: 5,
    };
  });
});
