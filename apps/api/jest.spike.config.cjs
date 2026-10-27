const base = require('./jest.config.cjs');

/**
 * SPIKE (PoC 1 and PoC 2): tests and measurements against the seeded spike databases
 * (spike/poc-1/setup-db.sh) and, for PoC 2, a running Keycloak and test LDAP. Not part of
 * `pnpm verify`. One file at a time, so measurements do not share the machine.
 * @type {import('jest').Config}
 */
module.exports = {
  ...base,
  testRegex: 'test/spike/.*\\.spike-spec\\.ts$',
  testTimeout: 600_000,
  maxWorkers: 1,
};
