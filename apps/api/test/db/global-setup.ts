import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { applicationDatabaseUrl, migrationDatabaseUrl, REPO_ROOT } from './test-database';

/** The group role every migration grants to (scripts/db/bootstrap-dev.sql). */
const APPLICATION_GROUP = 'phoenix_app';

/**
 * Creates a fresh database for this run as the migration role and applies all migrations to
 * it. Tests never clean tables; the whole database is dropped in global teardown instead. Two
 * URLs of it are exported: the application login and the owner.
 */
export default async function globalSetup(): Promise<void> {
  const name = `phoenix_test_${randomBytes(6).toString('hex')}`;
  const ownerUrl = new URL(migrationDatabaseUrl());
  ownerUrl.pathname = `/${name}`;
  const applicationUrl = new URL(applicationDatabaseUrl());
  applicationUrl.pathname = `/${name}`;

  const admin = new Client({ connectionString: migrationDatabaseUrl() });
  await admin.connect();
  try {
    // A migration that needs a superuser must fail here, not in production.
    const { rows } = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    if (rows[0]?.rolsuper !== false) {
      throw new Error(
        'MIGRATION_DATABASE_URL connects as a superuser; it must name the migration role ' +
          '(see .env.example and scripts/db/bootstrap-dev.sql).',
      );
    }
    await admin.query(`CREATE DATABASE "${name}"`);
    // Recorded at once, so that the teardown drops it even if a statement below fails.
    process.env.TEST_DATABASE_NAME = name;
    // A new database gets the default ACL, not its template's.
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE "${name}" TO "${APPLICATION_GROUP}"`);
  } finally {
    await admin.end();
  }

  process.env.TEST_DATABASE_URL = applicationUrl.toString();
  process.env.TEST_OWNER_DATABASE_URL = ownerUrl.toString();

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl.toString() },
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });

  await createCopy(name, 'LOCKING');
  await createCopy(name, 'DELIVERY');
  await createCopy(name, 'AUDIT');
}

/**
 * A copy of the migrated run database for one spec file that must not meet the others:
 * - `locking`: unit-of-work.db-spec.ts adds test-only triggers that raise serialisation
 *   failures, so no other file meets them.
 * - `delivery`: event-path.db-spec.ts relays and dispatches every pending row of a tenant, so
 *   no other file's outbox or delivery rows live there (ported from Mondapac's `delivery` copy).
 * - `audit`: platform-audit-chain.db-spec.ts seals every unsealed audit row of a tenant and
 *   writes rows the verifier must find, so no other file's audit rows live there.
 * Copied before any test connects, since a template must have no other session.
 */
async function createCopy(template: string, kind: 'LOCKING' | 'DELIVERY' | 'AUDIT'): Promise<void> {
  const name = `${template}_${kind.toLowerCase()}`;
  const admin = new Client({ connectionString: migrationDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    process.env[`TEST_${kind}_DATABASE_NAME`] = name;
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE "${name}" TO "${APPLICATION_GROUP}"`);
  } finally {
    await admin.end();
  }
  const ownerUrl = new URL(migrationDatabaseUrl());
  ownerUrl.pathname = `/${name}`;
  const applicationUrl = new URL(applicationDatabaseUrl());
  applicationUrl.pathname = `/${name}`;
  process.env[`TEST_${kind}_DATABASE_URL`] = applicationUrl.toString();
  process.env[`TEST_${kind}_OWNER_DATABASE_URL`] = ownerUrl.toString();
}
