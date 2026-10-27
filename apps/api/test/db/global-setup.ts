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
  await createCopy(name, 'AUDIT_WRITER');
}

/**
 * The copies whose spec uses the owner as an operator or an attacker who reads, arranges or
 * tampers with the rows of every tenant (event-path, the audit chain and the audit writer).
 * Their tables get NO FORCE ROW LEVEL SECURITY once, here: the owner can always lift FORCE, as
 * it can turn the audit triggers off (security review S5-2), and these specs prove what holds
 * against such an owner. The run database and the locking copy keep FORCE, and
 * row-level-security.db-spec.ts proves the owner sees no row there.
 */
const OWNER_LIFTS_FORCE = new Set<CopyKind>(['DELIVERY', 'AUDIT', 'AUDIT_WRITER']);

type CopyKind = 'LOCKING' | 'DELIVERY' | 'AUDIT' | 'AUDIT_WRITER';

/**
 * A copy of the migrated run database for one spec file that must not meet the others:
 * - `locking`: unit-of-work.db-spec.ts adds test-only triggers that raise serialisation
 *   failures, so no other file meets them.
 * - `delivery`: event-path.db-spec.ts relays and dispatches every pending row of a tenant, so
 *   no other file's outbox or delivery rows live there (ported from Mondapac's `delivery` copy).
 * - `audit`: platform-audit-chain.db-spec.ts seals every unsealed audit row of a tenant and
 *   writes rows the verifier must find, so no other file's audit rows live there.
 * - `audit_writer`: platform-audit.db-spec.ts reads the audit rows of every tenant as the
 *   owner (with FORCE lifted, see OWNER_LIFTS_FORCE), away from the run database that proves
 *   the owner sees nothing.
 * Copied before any test connects, since a template must have no other session.
 */
async function createCopy(template: string, kind: CopyKind): Promise<void> {
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
  if (OWNER_LIFTS_FORCE.has(kind)) await liftForce(ownerUrl.toString());
  process.env[`TEST_${kind}_DATABASE_URL`] = applicationUrl.toString();
  process.env[`TEST_${kind}_OWNER_DATABASE_URL`] = ownerUrl.toString();
}

/** NO FORCE ROW LEVEL SECURITY on every forced table of the database at `ownerUrl`. */
async function liftForce(ownerUrl: string): Promise<void> {
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ name: string }>(`
      SELECT format('%I.%I', n.nspname, c.relname) AS name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relforcerowsecurity`);
    for (const { name } of rows) {
      await owner.query(`ALTER TABLE ${name} NO FORCE ROW LEVEL SECURITY`);
    }
  } finally {
    await owner.end();
  }
}
