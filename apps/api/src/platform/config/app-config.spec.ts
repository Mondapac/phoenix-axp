import { InvalidConfigError, loadAppConfig as load } from './app-config';

const DATABASE_URL = 'postgresql://user:secret@localhost:5432/db';

/** Loads config with a valid DATABASE_URL and APP_ROLE unless the test overrides them. */
function loadAppConfig(env: Record<string, string | undefined>) {
  return load({ DATABASE_URL, APP_ROLE: 'api', ...env });
}

function issuesOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadAppConfig(env);
  } catch (error) {
    if (error instanceof InvalidConfigError) return error.issues;
    throw error;
  }
  throw new Error('expected InvalidConfigError');
}

/**
 * The session, Keycloak and subject-key settings a production start needs besides object
 * storage.
 */
const PRODUCTION_SESSION = {
  SESSION_SECRET: Buffer.alloc(32, 1).toString('base64url'),
  SUBJECT_KEY_KEK: Buffer.alloc(32, 2).toString('base64url'),
  KEYCLOAK_URL: 'https://sso.example.test',
  KEYCLOAK_STUDIO_CLIENT_SECRET: 'client-secret',
  STUDIO_SIGN_IN_CALLBACK_URL: 'https://studio.example.test/auth/callback',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'admin-secret',
};

/** The object storage issues only: production also requires the session settings. */
const storageIssuesOf = (env: Record<string, string | undefined>): readonly string[] =>
  issuesOf(env).filter((issue) => issue.startsWith('S3_'));

describe('loadAppConfig', () => {
  it('applies defaults and parses the hosted tenants list', () => {
    const config = loadAppConfig({ HOSTED_TENANTS: 'demo-fa, demo-en' });

    expect(config).toEqual({
      appRole: 'api',
      nodeEnv: 'development',
      nodeEnvExplicit: false,
      port: 3000,
      host: null,
      logLevel: 'info',
      hostedTenants: ['demo-fa', 'demo-en'],
      apiDocsEnabled: false,
      tenantConfigDirs: [expect.stringMatching(/config[\\/]tenants$/)],
      databaseUrl: DATABASE_URL,
      databasePoolMax: 10,
      storage: null,
      session: { secret: config.session.secret, panelOrigins: [], staffSessionHours: 8 },
      keycloak: null,
      subjectKeyKek: null,
    });
    expect(config.session.secret).toHaveLength(32);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.hostedTenants)).toBe(true);
  });

  it('takes the subject-key KEK as exactly 32 bytes of base64url (ADR-0003)', () => {
    const kek = Buffer.alloc(32, 7);
    expect(
      loadAppConfig({ HOSTED_TENANTS: 'demo-fa', SUBJECT_KEY_KEK: kek.toString('base64url') })
        .subjectKeyKek,
    ).toEqual(kek);
    for (const bad of [
      Buffer.alloc(16).toString('base64url'),
      kek.toString('base64'),
      'x'.repeat(44),
    ]) {
      expect(issuesOf({ HOSTED_TENANTS: 'demo-fa', SUBJECT_KEY_KEK: bad })).toEqual([
        expect.stringMatching(/^SUBJECT_KEY_KEK: must be exactly 32 random bytes/),
      ]);
    }
  });

  it('records whether NODE_ENV was set, for the placeholder check (ADR-0010 decision 4)', () => {
    expect(loadAppConfig({ HOSTED_TENANTS: 'demo-fa' }).nodeEnvExplicit).toBe(false);
    expect(
      loadAppConfig({ HOSTED_TENANTS: 'demo-fa', NODE_ENV: 'development' }).nodeEnvExplicit,
    ).toBe(true);
  });

  it('has no default tenant: HOSTED_TENANTS is required and never empty', () => {
    expect(issuesOf({})).toEqual([
      expect.stringContaining('HOSTED_TENANTS is required; there is no default tenant'),
    ]);
    expect(issuesOf({ HOSTED_TENANTS: ' , ' })).toEqual([
      expect.stringContaining('at least one tenant'),
    ]);
  });

  it.each(['Demo-fa', 'demo_fa', '1demo', 'a'])('refuses the malformed tenant id %p', (code) => {
    expect(issuesOf({ HOSTED_TENANTS: code })).toEqual([
      expect.stringContaining('must be a tenant id'),
    ]);
  });

  it('refuses a duplicated tenant', () => {
    expect(issuesOf({ HOSTED_TENANTS: 'demo-fa,demo-fa' })).toEqual([
      expect.stringContaining('HOSTED_TENANTS has duplicates'),
    ]);
  });

  it('requires APP_ROLE, with no default', () => {
    expect(issuesOf({ HOSTED_TENANTS: 'demo-fa', APP_ROLE: undefined })).toEqual([
      expect.stringContaining('APP_ROLE is required'),
    ]);
    expect(loadAppConfig({ HOSTED_TENANTS: 'demo-en', APP_ROLE: 'worker' }).appRole).toBe('worker');
  });

  it('refuses the migration URL in the application environment', () => {
    expect(
      issuesOf({ HOSTED_TENANTS: 'demo-fa', MIGRATION_DATABASE_URL: 'postgresql://m@h/db' }),
    ).toEqual([expect.stringContaining('MIGRATION_DATABASE_URL: must not be set')]);
  });

  it('refuses a DATABASE_URL that is not postgresql://, and a pool maximum out of range', () => {
    expect(issuesOf({ HOSTED_TENANTS: 'demo-fa', DATABASE_URL: 'mysql://x' })).toEqual([
      expect.stringContaining('DATABASE_URL'),
    ]);
    expect(issuesOf({ HOSTED_TENANTS: 'demo-fa', DATABASE_POOL_MAX: '0' })).toEqual([
      expect.stringContaining('DATABASE_POOL_MAX'),
    ]);
  });

  it('enables API docs only on an explicit "true"', () => {
    expect(
      loadAppConfig({ HOSTED_TENANTS: 'demo-fa', API_DOCS_ENABLED: 'true' }).apiDocsEnabled,
    ).toBe(true);
    expect(issuesOf({ HOSTED_TENANTS: 'demo-fa', API_DOCS_ENABLED: 'yes' })).toHaveLength(1);
  });

  it('never echoes the database URL in an issue', () => {
    const issues = issuesOf({ HOSTED_TENANTS: 'Bad', DATABASE_URL: 'postgresql://u:hunter2@h/d' });
    expect(issues.join('\n')).not.toContain('hunter2');
  });

  describe('object storage (ADR-0012)', () => {
    const STORAGE = {
      S3_ENDPOINT: 'http://localhost:8333',
      S3_BUCKET: 'phoenix',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    };

    it('reads the S3 variables, with the public endpoint and region defaulted', () => {
      expect(loadAppConfig({ HOSTED_TENANTS: 'acme-gov', ...STORAGE }).storage).toEqual({
        endpoint: 'http://localhost:8333',
        publicEndpoint: 'http://localhost:8333',
        region: 'us-east-1',
        bucket: 'phoenix',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      });
    });

    it('takes a separate public endpoint and region', () => {
      const config = loadAppConfig({
        HOSTED_TENANTS: 'acme-gov',
        ...STORAGE,
        S3_PUBLIC_ENDPOINT: 'https://files.example.test',
        S3_REGION: 'ir-thr-1',
      });

      expect(config.storage).toMatchObject({
        publicEndpoint: 'https://files.example.test',
        region: 'ir-thr-1',
      });
      expect(Object.isFrozen(config.storage)).toBe(true);
    });

    it('needs the four variables together', () => {
      expect(
        storageIssuesOf({ HOSTED_TENANTS: 'acme-gov', S3_ENDPOINT: 'http://localhost:8333' }),
      ).toEqual([
        expect.stringMatching(/^S3_BUCKET: .* are set together/),
        expect.stringMatching(/^S3_ACCESS_KEY_ID: /),
        expect.stringMatching(/^S3_SECRET_ACCESS_KEY: /),
      ]);
    });

    it('requires object storage in production', () => {
      expect(storageIssuesOf({ HOSTED_TENANTS: 'acme-gov', NODE_ENV: 'production' })).toEqual([
        'S3_ENDPOINT: required in production (object storage, ADR-0012)',
        'S3_BUCKET: required in production (object storage, ADR-0012)',
        'S3_ACCESS_KEY_ID: required in production (object storage, ADR-0012)',
        'S3_SECRET_ACCESS_KEY: required in production (object storage, ADR-0012)',
      ]);
      expect(
        loadAppConfig({
          HOSTED_TENANTS: 'acme-gov',
          NODE_ENV: 'production',
          ...STORAGE,
          S3_PUBLIC_ENDPOINT: 'https://files.example.test',
          S3_SECRET_ACCESS_KEY: 'a-real-secret',
          ...PRODUCTION_SESSION,
        }).storage,
      ).not.toBeNull();
    });

    it('needs https signed URLs and a real key in production', () => {
      expect(
        storageIssuesOf({
          HOSTED_TENANTS: 'acme-gov',
          NODE_ENV: 'production',
          ...STORAGE,
          S3_SECRET_ACCESS_KEY: 'phoenix-dev-secret',
        }),
      ).toEqual([
        expect.stringMatching(/^S3_ENDPOINT: signed URLs need https in production/),
        'S3_SECRET_ACCESS_KEY: the local development key is refused in production',
      ]);
      expect(
        storageIssuesOf({
          HOSTED_TENANTS: 'acme-gov',
          NODE_ENV: 'production',
          ...STORAGE,
          S3_PUBLIC_ENDPOINT: 'http://files.example.test',
          S3_SECRET_ACCESS_KEY: 'a-real-secret',
        }),
      ).toEqual([expect.stringMatching(/^S3_PUBLIC_ENDPOINT: signed URLs need https/)]);
    });

    it.each([
      ['S3_ENDPOINT', 'localhost:8333'],
      ['S3_PUBLIC_ENDPOINT', 'ftp://files'],
      ['S3_BUCKET', 'Phoenix_Files'],
      ['S3_BUCKET', 'ab'],
    ])('refuses %s=%p', (name, value) => {
      expect(storageIssuesOf({ HOSTED_TENANTS: 'acme-gov', ...STORAGE, [name]: value })).toEqual([
        expect.stringMatching(new RegExp(`^${name}: `)),
      ]);
    });

    it('never puts the secret in an issue', () => {
      const issues = storageIssuesOf({
        HOSTED_TENANTS: 'acme-gov',
        ...STORAGE,
        S3_SECRET_ACCESS_KEY: 'super-secret-value',
        S3_BUCKET: 'BAD',
      });

      expect(issues.join('\n')).not.toContain('super-secret-value');
    });
  });
  describe('sessions and Keycloak sign-in (ADR-0004)', () => {
    const SECRET = Buffer.alloc(32, 7).toString('base64url');
    const KEYCLOAK = {
      KEYCLOAK_URL: 'https://sso.example.test/',
      KEYCLOAK_STUDIO_CLIENT_SECRET: 'client-secret-value',
      STUDIO_SIGN_IN_CALLBACK_URL: 'https://studio.example.test/auth/callback',
    };

    it('reads the secret, the panel origins and the Keycloak settings', () => {
      const config = loadAppConfig({
        HOSTED_TENANTS: 'demo-fa',
        SESSION_SECRET: SECRET,
        PANEL_ORIGINS: 'https://studio.example.test, http://localhost:3001',
        STAFF_SESSION_HOURS: '4',
        HOST: '127.0.0.1',
        ...KEYCLOAK,
      });
      expect(config.host).toBe('127.0.0.1');
      expect(config.session).toEqual({
        secret: Buffer.alloc(32, 7),
        panelOrigins: ['https://studio.example.test', 'http://localhost:3001'],
        staffSessionHours: 4,
      });
      expect(config.keycloak).toEqual({
        url: 'https://sso.example.test',
        realmTemplate: 'phoenix-{tenant}',
        studioClientId: 'phoenix-studio',
        studioClientSecret: 'client-secret-value',
        studioCallbackUrl: 'https://studio.example.test/auth/callback',
        directoryClaim: 'ldap_id',
        adminClientId: 'phoenix-core-admin',
        adminClientSecret: null,
      });
    });

    it('draws a random secret per process outside production', () => {
      const a = loadAppConfig({ HOSTED_TENANTS: 'demo-fa' }).session.secret;
      const b = loadAppConfig({ HOSTED_TENANTS: 'demo-fa' }).session.secret;
      expect(a.equals(b)).toBe(false);
    });

    it('refuses a short secret, a path in an origin and a realm template without the tenant', () => {
      expect(
        issuesOf({
          HOSTED_TENANTS: 'demo-fa',
          SESSION_SECRET: 'short',
          PANEL_ORIGINS: 'https://studio.example.test/path',
          KEYCLOAK_REALM_TEMPLATE: 'shared',
        }),
      ).toEqual([
        expect.stringContaining('SESSION_SECRET'),
        expect.stringContaining('KEYCLOAK_REALM_TEMPLATE'),
      ]);
      expect(
        issuesOf({ HOSTED_TENANTS: 'demo-fa', PANEL_ORIGINS: 'https://studio.example.test/path' }),
      ).toEqual([expect.stringContaining('PANEL_ORIGINS')]);
    });

    it('takes the Keycloak variables together, and requires them, the admin client and the secret in production', () => {
      expect(
        issuesOf({ HOSTED_TENANTS: 'demo-fa', KEYCLOAK_URL: 'https://sso.example.test' }),
      ).toEqual([
        expect.stringMatching(/^KEYCLOAK_STUDIO_CLIENT_SECRET: .*set together/),
        expect.stringMatching(/^STUDIO_SIGN_IN_CALLBACK_URL: .*set together/),
      ]);
      const production = issuesOf({
        HOSTED_TENANTS: 'demo-fa',
        NODE_ENV: 'production',
        PANEL_ORIGINS: 'http://studio.example.test',
      }).filter((issue) => !issue.startsWith('S3_'));
      expect(production).toEqual([
        'SESSION_SECRET: required in production (sessions, ADR-0004)',
        'SUBJECT_KEY_KEK: required in production (personal data, ADR-0003)',
        'PANEL_ORIGINS: "http://studio.example.test" must be an origin over https',
        'KEYCLOAK_ADMIN_CLIENT_SECRET: required in production (directory sync, ADR-0022)',
        'KEYCLOAK_URL: required in production (staff sign-in, ADR-0004)',
        'KEYCLOAK_STUDIO_CLIENT_SECRET: required in production (staff sign-in, ADR-0004)',
        'STUDIO_SIGN_IN_CALLBACK_URL: required in production (staff sign-in, ADR-0004)',
      ]);
    });

    it('requires https to Keycloak in production', () => {
      expect(
        issuesOf({
          HOSTED_TENANTS: 'demo-fa',
          NODE_ENV: 'production',
          ...PRODUCTION_SESSION,
          KEYCLOAK_URL: 'http://sso.example.test',
        }).filter((issue) => issue.startsWith('KEYCLOAK')),
      ).toEqual(['KEYCLOAK_URL: must be https in production (client secrets, ADR-0004)']);
    });

    it('never puts a secret in an issue', () => {
      const issues = issuesOf({
        HOSTED_TENANTS: 'demo-fa',
        KEYCLOAK_STUDIO_CLIENT_SECRET: 'top-secret',
      });
      expect(issues.join('\n')).not.toContain('top-secret');
    });
  });
});
