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

describe('loadAppConfig', () => {
  it('applies defaults and parses the hosted tenants list', () => {
    const config = loadAppConfig({ HOSTED_TENANTS: 'demo-fa, demo-en' });

    expect(config).toEqual({
      appRole: 'api',
      nodeEnv: 'development',
      nodeEnvExplicit: false,
      port: 3000,
      logLevel: 'info',
      hostedTenants: ['demo-fa', 'demo-en'],
      apiDocsEnabled: false,
      tenantConfigDirs: [expect.stringMatching(/config[\\/]tenants$/)],
      databaseUrl: DATABASE_URL,
      databasePoolMax: 10,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.hostedTenants)).toBe(true);
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
});
