const db = require('./jest.db.config.cjs');

/**
 * PoC 3 (spike, not part of `pnpm verify`): the Flowable bridge against a real Flowable REST
 * engine and a throwaway core database. Needs PostgreSQL (DATABASE_URL, MIGRATION_DATABASE_URL),
 * Flowable (FLOWABLE_REST_URL, default http://127.0.0.1:8090/flowable-rest/service) and, for the
 * outage tests, infra/flowable/flowablectl.sh with FLOWABLE_WAR set. One file at a time: the
 * outage tests stop and start the shared engine.
 * @type {import('jest').Config}
 */
module.exports = {
  ...db,
  testRegex: 'test/poc/.*\\.poc-spec\\.ts$',
  testTimeout: 240_000,
  maxWorkers: 1,
};
