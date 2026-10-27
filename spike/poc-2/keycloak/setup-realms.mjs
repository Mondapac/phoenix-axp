// PoC 2 (slice 0.7): configures a running Keycloak for the two tenant fixtures through the
// admin REST API. Idempotent: an existing realm is deleted and created again.
//
//   KEYCLOAK_URL=http://127.0.0.1:8181 CORE_URL=http://127.0.0.1:3100 node setup-realms.mjs
//
// demo-fa: staff from the directory (LDAP federation, read-only) AND local staff accounts.
// demo-en: local staff accounts only (the tenant chose "local only", ADR-0019 decision 3).
// Keycloak answers "who are you" only (ADR-0004): no realm roles or groups are used for access.

const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:8181';
const CORE = process.env.CORE_URL ?? 'http://127.0.0.1:3190';
const LDAP_URL = process.env.LDAP_URL ?? 'ldap://127.0.0.1:10389';

// Test-only secrets, never real ones.
export const CLIENT_SECRETS = {
  studio: 'studio-client-secret-poc2',
  coreAdmin: 'core-admin-secret-poc2',
};

async function adminToken() {
  const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin-secret',
    }),
  });
  if (!response.ok) throw new Error(`admin token: ${response.status}`);
  return (await response.json()).access_token;
}

async function api(token, method, path, body) {
  const response = await fetch(`${KEYCLOAK}/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
}

function studioClient(tenantId) {
  return {
    clientId: 'phoenix-studio',
    name: 'Phoenix studio (core BFF)',
    protocol: 'openid-connect',
    publicClient: false,
    secret: CLIENT_SECRETS.studio,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [`${CORE}/spike/auth/callback`],
    webOrigins: [],
    frontchannelLogout: false,
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'backchannel.logout.url': `${CORE}/spike/backchannel/${tenantId}/logout`,
      'backchannel.logout.session.required': 'true',
      'backchannel.logout.revoke.offline.tokens': 'false',
    },
  };
}

const coreAdminClient = {
  clientId: 'phoenix-core-admin',
  name: 'Phoenix core (account administration and directory sync)',
  protocol: 'openid-connect',
  publicClient: false,
  secret: CLIENT_SECRETS.coreAdmin,
  standardFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: true,
};

function ldapComponent(realmId) {
  return {
    name: 'ministry-directory',
    providerId: 'ldap',
    providerType: 'org.keycloak.storage.UserStorageProvider',
    parentId: realmId,
    config: {
      enabled: ['true'],
      priority: ['0'],
      vendor: ['other'],
      connectionUrl: [LDAP_URL],
      authType: ['simple'],
      bindDn: ['cn=keycloak,dc=phoenix,dc=test'],
      bindCredential: ['keycloak-bind'],
      usersDn: ['ou=people,dc=phoenix,dc=test'],
      searchScope: ['1'],
      usernameLDAPAttribute: ['uid'],
      rdnLDAPAttribute: ['uid'],
      uuidLDAPAttribute: ['entryUUID'],
      userObjectClasses: ['inetOrgPerson, organizationalPerson'],
      // A disabled directory account no longer matches, so Keycloak neither signs it in nor
      // finds it by id (the core's directory sync reads that as "disabled").
      customUserSearchFilter: ['(!(employeeType=disabled))'],
      editMode: ['READ_ONLY'],
      importEnabled: ['true'],
      syncRegistrations: ['false'],
      // Every lookup reads the directory: a disable is visible to the next lookup.
      cachePolicy: ['NO_CACHE'],
      pagination: ['false'],
      trustEmail: ['true'],
      fullSyncPeriod: ['-1'],
      changedSyncPeriod: ['-1'],
    },
  };
}

async function createRealm(token, tenantId, { directory, localUsers }) {
  const realm = `phoenix-${tenantId}`;
  await api(token, 'DELETE', `/realms/${realm}`);
  await api(token, 'POST', '/realms', {
    realm,
    enabled: true,
    // Brute-force protection and password policy would be tenant configuration; off in the PoC.
    registrationAllowed: false,
    loginWithEmailAllowed: false,
    duplicateEmailsAllowed: false,
    ssoSessionIdleTimeout: 1800,
    accessTokenLifespan: 300,
  });
  const { json: realmRep } = await api(token, 'GET', `/realms/${realm}`);
  await api(token, 'POST', `/realms/${realm}/clients`, studioClient(tenantId));
  await api(token, 'POST', `/realms/${realm}/clients`, coreAdminClient);

  // The core's service account may read and disable users, nothing else.
  const { json: clients } = await api(
    token,
    'GET',
    `/realms/${realm}/clients?clientId=phoenix-core-admin`,
  );
  const { json: serviceUser } = await api(
    token,
    'GET',
    `/realms/${realm}/clients/${clients[0].id}/service-account-user`,
  );
  const { json: rm } = await api(
    token,
    'GET',
    `/realms/${realm}/clients?clientId=realm-management`,
  );
  const { json: rmRoles } = await api(token, 'GET', `/realms/${realm}/clients/${rm[0].id}/roles`);
  const wanted = rmRoles.filter((role) => ['view-users', 'manage-users'].includes(role.name));
  await api(
    token,
    'POST',
    `/realms/${realm}/users/${serviceUser.id}/role-mappings/clients/${rm[0].id}`,
    wanted,
  );

  if (directory) {
    await api(token, 'POST', `/realms/${realm}/components`, ldapComponent(realmRep.id));
  }
  for (const user of localUsers) {
    await api(token, 'POST', `/realms/${realm}/users`, {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: 'Local',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: user.password, temporary: false }],
    });
  }
  console.log(
    `realm ${realm}: directory=${directory} local=${localUsers.map((u) => u.username).join(',')}`,
  );
}

const token = await adminToken();
await createRealm(token, 'demo-fa', {
  directory: true,
  localUsers: [
    { username: 'bahar', email: 'bahar@ministry.test', firstName: 'Bahar', password: 'bahar-pass' },
    { username: 'sara', email: 'sara@ministry.test', firstName: 'Sara', password: 'sara-pass' },
    // A Keycloak user with no core staff account: sign-in must be refused.
    { username: 'lena', email: 'lena@ministry.test', firstName: 'Lena', password: 'lena-pass' },
  ],
});
await createRealm(token, 'demo-en', {
  directory: false,
  localUsers: [
    { username: 'emma', email: 'emma@agency.test', firstName: 'Emma', password: 'emma-pass' },
  ],
});
