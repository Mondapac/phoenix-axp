import { defineConfig } from 'prisma/config';

// Prisma CLI configuration (ADR-02). The schema is split into one file per module under
// prisma/schema/. Every prisma command connects as the migration role, through
// MIGRATION_DATABASE_URL from the environment or a local .env file; it never falls back to
// DATABASE_URL, the application's login.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment (CI, the migration job).
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` needs no database; commands that do will fail on this placeholder.
    url: process.env.MIGRATION_DATABASE_URL ?? 'postgresql://missing-MIGRATION_DATABASE_URL',
  },
});
