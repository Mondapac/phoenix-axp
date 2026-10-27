import { Harness, TENANTS } from './support/harness';
import { record } from './support/results';

// PoC 3, a rough cost of the polling bridge on this machine (not a load test): how long the
// relay takes to start N instances, and how long one sync pass takes with N open tasks, per
// tenant. It informs the "polling or engine-side events" verdict.

const N = 100;

describe('PoC 3: polling cost (indicative)', () => {
  const h = new Harness();

  beforeAll(() => h.seed());
  afterAll(() => h.close());

  it.each(TENANTS)(`%s: ${N} requests through relay and sync`, async (code) => {
    const tenant = h.tenant(code);
    for (let index = 0; index < N; index += 1) await h.submitLeave(code);

    let started = Date.now();
    for (;;) if ((await h.relay.runOnce(tenant)).claimed === 0) break;
    const relayMs = Date.now() - started;

    started = Date.now();
    const first = await h.sync.runOnce(tenant);
    const firstSyncMs = Date.now() - started;

    started = Date.now();
    const idle = await h.sync.runOnce(tenant);
    const idleSyncMs = Date.now() - started;

    // At least N: the first pass also closes what earlier spec files left (their instances
    // were deleted by the seed, so those requests end cancelled).
    expect(first.applied).toBeGreaterThanOrEqual(N);
    expect(idle.applied).toBe(0);
    expect(await h.inboxOf(code, 'approver')).toHaveLength(N);
    record('P1 polling cost', {
      tenant: code,
      requests: N,
      relayMs,
      relayMsPerCommand: relayMs / N,
      firstSyncMs,
      idleSyncMs,
      engineCallsPerIdlePass: 'listOpenTasks pages + 1 history call per running request',
    });
  });
});
