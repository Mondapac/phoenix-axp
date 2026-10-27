import {
  eventually,
  expectCriterion,
  FORM_KEY,
  Harness,
  PROCESS_KEY,
  TENANTS,
} from './support/harness';
import { record } from './support/results';

// PoC 3, the end-to-end approval flow on both tenant fixtures: a JSON Schema form submitted in
// the core, the outbox starting the Flowable process, the task surfacing in the core's Task
// Inbox and authorised there, completion going back through the bridge, and the deadline
// escalating to the manager.

describe('PoC 3: approval flow through the bridge (both tenants)', () => {
  const h = new Harness();

  beforeAll(() => h.seed());
  afterAll(() => h.close());
  afterEach(() => {
    h.engine.reset();
    h.escalateAfterSeconds = 3600;
  });

  it.each(TENANTS)(
    '%s: refuses an answer the form schema refuses; nothing reaches the outbox',
    async (code) => {
      const count = 'SELECT count(*)::int AS n FROM process.outbox WHERE tenant_id = $1';
      const [before] = await h.sql<{ n: number }>(count, [code]);
      const result = await h.submit.execute(h.as(code, 'requester'), {
        formKey: FORM_KEY,
        processKey: PROCESS_KEY,
        answers: { leaveType: 'holiday', startDate: '10/11/2026', days: 0, extra: true },
      });
      expect(result.ok).toBe(false);
      const error = result.ok ? null : result.error;
      expect(error?.code).toBe('request.invalid');
      // The root ("/": the undeclared key) and each invalid field, by JSON pointer only.
      expect([...(error?.code === 'request.invalid' ? error.fields : [])].sort()).toEqual([
        '/',
        '/days',
        '/leaveType',
        '/startDate',
      ]);
      expect(await h.sql<{ n: number }>(count, [code])).toEqual([before]);
    },
  );

  it.each(TENANTS)(
    '%s: submit, approve, done; only the assignee sees and completes the task',
    async (code) => {
      const requestId = await h.submitLeave(code);

      // V3 snapshot: form revision, process revision and hash travel with the request.
      const [snapshot] = await h.sql<Record<string, string>>(
        `SELECT r.content_hash, r.form_revision_id, r.process_revision_id, r.status, o.type, o.published_at
         FROM process.request r JOIN process.outbox o ON o.aggregate_id = r.id
        WHERE r.tenant_id = $1 AND r.id = $2`,
        [code, requestId],
      );
      expect(snapshot).toMatchObject({
        status: 'submitted',
        type: 'process.request-submitted.v1',
        published_at: null,
      });
      expect(snapshot!.content_hash).toMatch(/^[0-9a-f]{64}$/);

      await h.converge(code);
      const inbox = await h.inboxOf(code, 'approver');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        taskKey: 'approve',
        status: 'open',
        formKey: 'leave-approval-decision',
      });
      expect(await h.inboxOf(code, 'manager')).toHaveLength(0);
      expect(await h.inboxOf(code, 'outsider')).toHaveLength(0);

      // Authorisation is the core's: another person, even of the same tenant, gets "not found".
      expect(await h.decide(code, 'outsider', inbox[0]!.id, 'approve')).toEqual({
        ok: false,
        error: { code: 'task.not-found' },
      });
      // The other tenant's people cannot see it either: the core's RLS hides the row.
      const other = TENANTS.find((tenant) => tenant !== code)!;
      expect(
        await h.completeTask.execute(h.as(other, 'approver'), {
          taskId: inbox[0]!.id,
          decision: 'approve',
        }),
      ).toEqual({
        ok: false,
        error: { code: 'task.not-found' },
      });

      expect(await h.decide(code, 'approver', inbox[0]!.id, 'approve')).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await h.decide(code, 'approver', inbox[0]!.id, 'approve')).toEqual({
        ok: false,
        error: { code: 'task.not-open' },
      });
      await h.converge(code);

      const report = await h.criterion(code, requestId);
      expectCriterion(report);
      expect(report.requestStatus).toBe('approved');
      // Tenant on every engine object: the instance and the task carry the tenant id.
      const [task] = await h.sql<{ status: string }>(
        'SELECT status FROM process.task WHERE tenant_id = $1 AND request_id = $2',
        [code, requestId],
      );
      expect(task!.status).toBe('completed');
      expect(await h.incidents(code)).toEqual([]);
      record('happy-path', { tenant: code, ...report });
    },
  );

  it.each(TENANTS)('%s: a reject ends the request rejected', async (code) => {
    const requestId = await h.submitLeave(code);
    await h.converge(code);
    const [task] = await h.inboxOf(code, 'approver');
    expect(await h.decide(code, 'approver', task!.id, 'reject')).toMatchObject({ ok: true });
    await h.converge(code);
    expect((await h.criterion(code, requestId)).requestStatus).toBe('rejected');
  });

  it.each(TENANTS)('%s: the deadline moves the decision to the manager', async (code) => {
    h.escalateAfterSeconds = 3;
    const requestId = await h.submitLeave(code);
    await h.converge(code);
    const [first] = await h.inboxOf(code, 'approver');
    expect(first).toMatchObject({ taskKey: 'approve' });
    const started = Date.now();

    await eventually(async () => {
      await h.converge(code);
      return (await h.inboxOf(code, 'manager')).length === 1;
    }, 30_000);
    const escalatedAfterMs = Date.now() - started;

    expect(await h.inboxOf(code, 'approver')).toHaveLength(0);
    const [escalated] = await h.inboxOf(code, 'manager');
    expect(escalated).toMatchObject({ taskKey: 'approveEscalated', status: 'open' });
    const [old] = await h.sql<{ status: string }>(
      'SELECT status FROM process.task WHERE tenant_id = $1 AND id = $2',
      [code, first!.id],
    );
    expect(old!.status).toBe('escalated');

    expect(await h.decide(code, 'manager', escalated!.id, 'approve')).toMatchObject({ ok: true });
    await h.converge(code);
    const report = await h.criterion(code, requestId);
    expectCriterion(report);
    expect(report).toMatchObject({ requestStatus: 'approved', engineTasks: 2 });
    record('timer-escalation', { tenant: code, escalatedAfterMs, deadlineMs: 3000, ...report });
  });
});
