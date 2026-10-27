const base = require('./jest.config.cjs');

/**
 * Object storage integration tests (ADR-0012). They need a reachable S3-compatible store
 * (S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, for example SeaweedFS from
 * `docker compose up -d seaweedfs`); each run works in its own throwaway bucket.
 * @type {import('jest').Config}
 */
module.exports = {
  ...base,
  testRegex: 'test/storage/.*\\.storage-spec\\.ts$',
  testTimeout: 30_000,
};
