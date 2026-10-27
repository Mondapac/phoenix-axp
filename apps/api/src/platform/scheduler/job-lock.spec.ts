// Ported from Mondapac apps/api/src/platform/scheduler/job-lock.spec.ts. Phoenix hashes
// `phoenix.job:<name>`, so the pinned keys are Phoenix's own (computed with SHA-256 by hand).
import { jobLockKey, PRISMA_MIGRATE_LOCK_KEY } from './job-lock';

describe('jobLockKey (platform persistence design 7; PM8)', () => {
  it('is the first 8 bytes of SHA-256 over phoenix.job:<name>, pinned for two names', () => {
    // sha256('phoenix.job:identity.purge-expired') starts 0ff0ae443573413f.
    expect(jobLockKey('identity.purge-expired')).toBe(0x0ff0ae443573413fn);
    expect(jobLockKey('identity.purge-expired')).toBe(1148609512957231423n);
    expect(jobLockKey('audit.seal-chain')).toBe(5973095807648092495n);
  });

  it('is a signed 64-bit integer, stable, and different per name', () => {
    const key = jobLockKey('sellers.some-job');

    expect(key).toBe(jobLockKey('sellers.some-job'));
    expect(key).not.toBe(jobLockKey('sellers.other-job'));
    expect(BigInt.asIntN(64, key)).toBe(key);
  });

  it('never equals the session lock key Prisma Migrate holds (72707369), for the jobs we know', () => {
    for (const name of ['identity.purge-expired', 'audit.seal-chain']) {
      expect(jobLockKey(name)).not.toBe(PRISMA_MIGRATE_LOCK_KEY);
    }
  });
});
