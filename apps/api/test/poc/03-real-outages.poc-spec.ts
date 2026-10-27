import { EngineUnavailableError } from '../../src/modules/process/application/ports/process-engine';
import { killFlowable, startFlowable } from './support/flowable';
import { eventually, expectCriterion, Harness, sleep, TENANTS } from './support/harness';
import { record } from './support/results';
import { killWorkerAfter } from './support/worker-process';

// PoC 3, the failures that need real processes: Flowable killed (SIGKILL) and started again,
// a timer that falls due while Flowable is down, and a worker process killed mid-relay. Slow:
// each Flowable restart takes 15 to 20 s.

const LEASE_MS = 2_000;

describe('PoC 3: real outages', () => {
  const h = new Harness();

  beforeAll(() => h.seed());
  afterAll(async () => {
    startFlowable(); // leave the engine running whatever happened
    await h.close();
  });
  beforeEach(() => {
    h.relay = h.newRelay({ leaseMs: LEASE_MS });
  });
  afterEach(async () => {
    h.engine.reset();
    h.escalateAfterSeconds = 3600;
    await h.sql('DELETE FROM process.incident');
  });

  async function openRequest(code: string) {
    const requestId = await h.submitLeave(code);
    await h.converge(code);
    const task = (await h.inboxOf(code, 'approver')).find(
      (entry) => entry.requestId === requestId,
    )!;
    return { requestId, taskId: task.id };
  }

  it('O1 Flowable killed and restarted: commands and observations resume, nothing lost or doubled', async () => {
    const before = await Promise.all(TENANTS.map((code) => openRequest(code)));
    for (const [index, code] of TENANTS.entries()) {
      expect(await h.decide(code, 'approver', before[index]!.taskId, 'approve')).toMatchObject({
        ok: true,
      });
    }
    killFlowable();
    const during: Record<string, string[]> = {};
    for (const code of TENANTS) {
      during[code] = [await h.submitLeave(code), await h.submitLeave(code)];
      const pass = await h.relay.runOnce(h.tenant(code));
      expect(pass).toMatchObject({ delivered: 0, retried: 3 });
      await expect(h.sync.runOnce(h.tenant(code))).rejects.toBeInstanceOf(EngineUnavailableError);
    }
    const errors = await h.sql<{ last_error: string; count: string }>(
      `SELECT last_error, count(*) FROM process.outbox WHERE published_at IS NULL GROUP BY 1`,
    );
    const downAt = Date.now();
    startFlowable();
    const restartMs = Date.now() - downAt;
    for (const code of TENANTS) await h.converge(code);

    const reports = [];
    for (const [index, code] of TENANTS.entries()) {
      for (const requestId of [before[index]!.requestId, ...during[code]!]) {
        const report = await h.criterion(code, requestId);
        expectCriterion(report);
        reports.push({ tenant: code, requestId, ...report });
      }
      expect((await h.criterion(code, before[index]!.requestId)).requestStatus).toBe('approved');
    }
    expect(await h.sql('SELECT 1 FROM process.outbox WHERE published_at IS NULL')).toHaveLength(0);
    record('O1 Flowable SIGKILL and restart', { restartMs, pendingWhileDown: errors, reports });
  });

  it('O2 a deadline falls due while Flowable is down: it fires on restart and escalates', async () => {
    h.escalateAfterSeconds = 5;
    const opened = await Promise.all(TENANTS.map((code) => openRequest(code)));
    killFlowable();
    await sleep(7_000); // the deadline passes with the engine down
    startFlowable();
    const restartedAt = Date.now();
    for (const [index, code] of TENANTS.entries()) {
      await eventually(async () => {
        await h.converge(code);
        const [task] = await h.sql<{ status: string }>(
          'SELECT status FROM process.task WHERE tenant_id = $1 AND id = $2',
          [code, opened[index]!.taskId],
        );
        return task!.status === 'escalated';
      }, 30_000);
    }
    const escalatedAfterRestartMs = Date.now() - restartedAt;
    for (const [index, code] of TENANTS.entries()) {
      const report = await h.criterion(code, opened[index]!.requestId);
      expectCriterion(report);
      expect(report.engineTasks).toBe(2);
    }
    record('O2 timer due during Flowable outage', { escalatedAfterRestartMs, tenants: TENANTS });
  });

  it.each(TENANTS)(
    'O3 %s: worker killed right after Flowable started the instance',
    async (code) => {
      const requestId = await h.submitLeave(code);
      const killed = await killWorkerAfter(code, 'startInstance', LEASE_MS);
      expect(killed).toEqual({ killedAfter: 'startInstance', signal: 'SIGKILL' });
      const [row] = await h.sql<{ attempts: number; published_at: Date | null }>(
        'SELECT attempts, published_at FROM process.outbox WHERE tenant_id = $1 AND aggregate_id = $2',
        [code, requestId],
      );
      expect(row).toMatchObject({ attempts: 1, published_at: null });
      await sleep(LEASE_MS + 200);
      await h.converge(code);
      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(report.deletedOrphans).toBe(0);
      expect(h.engine.callsTo('startInstance')).toBe(0); // adopted, not started again
      record('O3 worker SIGKILL after Flowable start', { tenant: code, ...report });
    },
  );

  it.each(TENANTS)('O4 %s: worker killed right after Flowable completed the task', async (code) => {
    const { requestId, taskId } = await openRequest(code);
    expect(await h.decide(code, 'approver', taskId, 'reject')).toMatchObject({ ok: true });
    const killed = await killWorkerAfter(code, 'completeTask', LEASE_MS);
    expect(killed.killedAfter).toBe('completeTask');
    await sleep(LEASE_MS + 200);
    h.engine.reset();
    // The relay first this time (the sync is the first in F3).
    await h.relay.runOnce(h.tenant(code));
    await h.converge(code);
    const report = await h.criterion(code, requestId);
    expectCriterion(report);
    expect(report.requestStatus).toBe('rejected');
    expect(h.engine.callsTo('completeTask')).toBe(1); // answered "gone", then matched by key
    expect(await h.sql('SELECT 1 FROM process.incident')).toHaveLength(0);
    record('O4 worker SIGKILL after Flowable complete', { tenant: code, ...report });
  });
});
