// Ported from Mondapac apps/api/src/platform/persistence/advisory-job-lock.spec.ts.
import { AdvisoryJobLock } from './advisory-job-lock';
import type { PrismaRoot } from './prisma-root';

// The scheduler lock waits for a pooled connection as long as its root's pool does: 2 s in the
// application, the longer wait of the database test harness there (a 2 s wait under CI load
// failed scheduler.db-spec with "Unable to start a transaction in the given time").

describe('AdvisoryJobLock', () => {
  it("passes its root's connection wait as the transaction's maxWait, and maxRunMs as timeout", async () => {
    const seen: unknown[] = [];
    const root = {
      connectionWaitMs: 10_000,
      $transaction: (
        work: (transaction: unknown) => Promise<unknown>,
        options: unknown,
      ): Promise<unknown> => {
        seen.push(options);
        return work({
          $executeRawUnsafe: () => Promise.resolve(0),
          $queryRaw: () => Promise.resolve([{ locked: true }]),
        });
      },
    } as unknown as PrismaRoot;

    await expect(
      new AdvisoryJobLock(root).runExclusive(1n, 60_000, () => Promise.resolve()),
    ).resolves.toBe('ran');
    expect(seen).toEqual([{ maxWait: 10_000, timeout: 60_000 }]);
  });
});
