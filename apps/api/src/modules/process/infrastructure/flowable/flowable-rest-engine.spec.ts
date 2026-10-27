import { Temporal } from '@phoenix/shared-kernel';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import {
  EngineRefusedError,
  EngineTenantMismatchError,
  EngineUnavailableError,
} from '../../application/ports/process-engine';
import {
  COMPLETION_KEY_VARIABLE,
  FlowableRestEngine,
  INSTANCE_VARIABLE,
  instantOfEngine,
} from './flowable-rest-engine';

// The Flowable REST adapter against a scripted HTTP server (ADR-0020 decision 6, PoC 3 R8):
// every query passes the tenant on the wire, and every query refuses an object of another
// tenant, or another id or business key, as Flowable would return when it ignored a filter.
// The real engine runs in the PoC suite and, once packaged (slice 2.1), in its own job.

interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

type Route = (call: Call) => { status: number; json?: unknown } | undefined;

function scripted(routes: Route[]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/flowable-rest/service', ''),
      query: url.searchParams,
      body,
    };
    calls.push(call);
    for (const route of routes) {
      const answer = route(call);
      if (answer !== undefined) {
        return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), {
          status: answer.status,
        });
      }
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const engine = new FlowableRestEngine(
    { url: 'http://flowable:8080/flowable-rest/service', user: 'core', password: 'secret' },
    fetchFn,
  );
  return { engine, calls };
}

const page = (data: unknown[]) => ({ status: 200, json: { data, total: data.length } });
const on =
  (method: string, path: string, answer: (call: Call) => { status: number; json?: unknown }): Route =>
  (call) =>
    call.method === method && call.path === path ? answer(call) : undefined;

const TIME = '2026-10-27T12:00:00.000+0000';
const LATER = '2026-10-27T12:05:00.000+0000';

describe.each(['demo-fa', 'demo-en'])('FlowableRestEngine in tenant %s', (tenantId) => {
  const tenant = testTenantContext(tenantId);
  const other = tenantId === 'demo-fa' ? 'demo-en' : 'demo-fa';
  const instance = (fields: Record<string, unknown> = {}) => ({
    id: 'pi-1',
    businessKey: 'bk-1',
    startTime: TIME,
    endTime: null,
    deleteReason: null,
    tenantId,
    ...fields,
  });
  const task = (fields: Record<string, unknown> = {}) => ({
    id: 't-1',
    processInstanceId: 'pi-1',
    taskDefinitionKey: 'approve',
    formKey: 'leave-decision',
    tenantId,
    variables: [{ name: INSTANCE_VARIABLE, value: 'core-1' }],
    ...fields,
  });

  describe('findInstancesByBusinessKey', () => {
    it('asks by business key and tenant, oldest first', async () => {
      const { engine, calls } = scripted([
        on('GET', '/history/historic-process-instances', () =>
          page([instance(), instance({ id: 'pi-2', startTime: LATER })]),
        ),
      ]);
      const found = await engine.findInstancesByBusinessKey(tenant, 'bk-1');
      expect(found.map((entry) => entry.engineInstanceId)).toEqual(['pi-1', 'pi-2']);
      expect(calls[0]!.query.get('tenantId')).toBe(tenantId);
      expect(calls[0]!.query.get('businessKey')).toBe('bk-1');
      expect(calls[0]!.query.get('sort')).toBe('startTime');
    });

    it.each([
      ['another tenant', { tenantId: other }],
      ['another business key', { businessKey: 'bk-2' }],
    ])('refuses an instance of %s', async (_label, fields) => {
      const { engine } = scripted([
        on('GET', '/history/historic-process-instances', () => page([instance(fields)])),
      ]);
      await expect(engine.findInstancesByBusinessKey(tenant, 'bk-1')).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
    });
  });

  describe('deployRevision and startInstance', () => {
    const deployment = { id: 'dep-1', name: 'leave@rev-1', tenantId };
    const definition = { id: 'def-1', key: 'leave', deploymentId: 'dep-1', tenantId };
    const command = {
      processKey: 'leave',
      revisionId: 'rev-1',
      businessKey: 'bk-1',
      variables: { days: 3 },
    };

    it('deploys once per revision name, under the tenant', async () => {
      const deployed = scripted([
        on('GET', '/repository/deployments', () => page([])),
        on('POST', '/repository/deployments', () => ({ status: 201, json: deployment })),
      ]);
      await deployed.engine.deployRevision(tenant, { ...command, bpmnXml: '<definitions/>' });
      const post = deployed.calls.find((call) => call.method === 'POST')!;
      expect(post.query.get('tenantId')).toBe(tenantId);
      expect(post.query.get('deploymentName')).toBe('leave@rev-1');

      const repeat = scripted([on('GET', '/repository/deployments', () => page([deployment]))]);
      await repeat.engine.deployRevision(tenant, { ...command, bpmnXml: '<definitions/>' });
      expect(repeat.calls.map((call) => call.method)).toEqual(['GET']);
    });

    it.each([
      ['a deployment of another tenant', [{ ...deployment, tenantId: other }], [definition]],
      ['a deployment of another name', [{ ...deployment, name: 'leave@rev-2' }], [definition]],
      ['a definition of another tenant', [deployment], [{ ...definition, tenantId: other }]],
      ['a definition of another deployment', [deployment], [{ ...definition, deploymentId: 'x' }]],
      ['a definition of another key', [deployment], [{ ...definition, key: 'other' }]],
    ])('refuses %s', async (_label, deployments, definitions) => {
      const { engine } = scripted([
        on('GET', '/repository/deployments', () => page(deployments)),
        on('GET', '/repository/process-definitions', () => page(definitions)),
        on('POST', '/runtime/process-instances', () => ({ status: 201, json: instance() })),
      ]);
      await expect(engine.startInstance(tenant, command)).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
    });

    it('starts exactly the revision deployment, with typed variables and the core instance id', async () => {
      const { engine, calls } = scripted([
        on('GET', '/repository/deployments', () => page([deployment])),
        on('GET', '/repository/process-definitions', () => page([definition])),
        on('POST', '/runtime/process-instances', () => ({ status: 201, json: instance() })),
      ]);
      const started = await engine.startInstance(tenant, command);
      expect(started).toMatchObject({ engineInstanceId: 'pi-1', businessKey: 'bk-1' });
      const post = calls.find((call) => call.method === 'POST')!;
      expect(post.body).toEqual({
        processDefinitionId: 'def-1',
        businessKey: 'bk-1',
        variables: [
          { name: 'days', type: 'long', value: 3 },
          { name: INSTANCE_VARIABLE, type: 'string', value: 'bk-1' },
        ],
      });
      expect(calls.find((call) => call.path === '/repository/process-definitions')!.query.get(
        'tenantId',
      )).toBe(tenantId);
    });

    it.each([
      ['another tenant', { tenantId: other }],
      ['another business key', { businessKey: 'bk-2' }],
    ])('refuses a started instance of %s', async (_label, fields) => {
      const { engine } = scripted([
        on('GET', '/repository/deployments', () => page([deployment])),
        on('GET', '/repository/process-definitions', () => page([definition])),
        on('POST', '/runtime/process-instances', () => ({ status: 201, json: instance(fields) })),
      ]);
      await expect(engine.startInstance(tenant, command)).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
    });

    it('refuses to start a revision that is not deployed', async () => {
      const { engine } = scripted([on('GET', '/repository/deployments', () => page([]))]);
      await expect(engine.startInstance(tenant, command)).rejects.toBeInstanceOf(
        EngineRefusedError,
      );
    });
  });

  describe('deleteInstance', () => {
    it('deletes a running instance of the tenant, and treats a gone one as done', async () => {
      const { engine, calls } = scripted([
        on('GET', '/runtime/process-instances/pi-1', () => ({ status: 200, json: instance() })),
        on('DELETE', '/runtime/process-instances/pi-1', () => ({ status: 204 })),
      ]);
      await engine.deleteInstance(tenant, 'pi-1', 'phoenix: orphan instance');
      expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
      expect(calls[1]!.query.get('deleteReason')).toBe('phoenix: orphan instance');
      await engine.deleteInstance(tenant, 'pi-9', 'x');
    });

    it.each([
      ['another tenant', { tenantId: other }],
      ['another id', { id: 'pi-2' }],
    ])('never deletes an instance of %s', async (_label, fields) => {
      const { engine, calls } = scripted([
        on('GET', '/runtime/process-instances/pi-1', () => ({
          status: 200,
          json: instance(fields),
        })),
      ]);
      await expect(engine.deleteInstance(tenant, 'pi-1', 'x')).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
      expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    });
  });

  describe('listOpenTasks', () => {
    it('pages through the open tasks of the tenant, with the core instance id', async () => {
      const first = Array.from({ length: 100 }, (_, i) => task({ id: `t-${i}` }));
      const { engine, calls } = scripted([
        on('GET', '/runtime/tasks', (call) =>
          call.query.get('start') === '0'
            ? { status: 200, json: { data: first, total: 101 } }
            : { status: 200, json: { data: [task({ id: 't-100' })], total: 101 } },
        ),
      ]);
      const tasks = await engine.listOpenTasks(tenant);
      expect(tasks).toHaveLength(101);
      expect(tasks[0]).toEqual({
        engineTaskId: 't-0',
        engineInstanceId: 'pi-1',
        taskKey: 'approve',
        formKey: 'leave-decision',
        coreInstanceId: 'core-1',
      });
      expect(calls.every((call) => call.query.get('tenantId') === tenantId)).toBe(true);
    });

    it('refuses a task of another tenant', async () => {
      const { engine } = scripted([
        on('GET', '/runtime/tasks', () => page([task(), task({ id: 't-2', tenantId: other })])),
      ]);
      await expect(engine.listOpenTasks(tenant)).rejects.toBeInstanceOf(EngineTenantMismatchError);
    });
  });

  describe('listEndedTasks', () => {
    const ended = (fields: Record<string, unknown> = {}) =>
      task({
        endTime: LATER,
        deleteReason: null,
        variables: [
          { name: INSTANCE_VARIABLE, value: 'core-1' },
          { name: COMPLETION_KEY_VARIABLE, value: 'key-1' },
        ],
        ...fields,
      });

    it('reads what ended after the watermark, by end time, with the completion key', async () => {
      const { engine, calls } = scripted([
        on('GET', '/history/historic-task-instances', () =>
          page([ended(), ended({ id: 't-2', deleteReason: 'boundary event (timer)' })]),
        ),
      ]);
      const records = await engine.listEndedTasks(
        tenant,
        Temporal.Instant.from('2026-10-27T12:00:00Z'),
        500,
      );
      expect(records.map((record) => record.end)).toEqual([
        { kind: 'completed', completionKey: 'key-1' },
        { kind: 'deleted', reason: 'boundary event (timer)' },
      ]);
      expect(records[0]!.endedAt?.toString()).toBe('2026-10-27T12:05:00Z');
      const query = calls[0]!.query;
      expect(query.get('tenantId')).toBe(tenantId);
      expect(query.get('finished')).toBe('true');
      expect(query.get('taskCompletedAfter')).toBe('2026-10-27T12:00:00.000Z');
      expect(query.get('sort')).toBe('endTime');
    });

    it.each([
      ['another tenant', { tenantId: other }],
      ['a task still open (an ignored filter)', { endTime: null }],
    ])('refuses a task of %s', async (_label, fields) => {
      const { engine } = scripted([
        on('GET', '/history/historic-task-instances', () => page([ended(fields)])),
      ]);
      await expect(engine.listEndedTasks(tenant, null, 500)).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
    });
  });

  describe('listEndedInstances', () => {
    it('reads what ended after the watermark, telling deletion from an end event', async () => {
      const { engine, calls } = scripted([
        on('GET', '/history/historic-process-instances', () =>
          page([
            instance({ endTime: LATER }),
            instance({ id: 'pi-2', endTime: LATER, deleteReason: 'operator' }),
          ]),
        ),
      ]);
      const found = await engine.listEndedInstances(tenant, null, 500);
      expect(found.map((entry) => entry.deleted)).toEqual([false, true]);
      expect(calls[0]!.query.get('finished')).toBe('true');
      expect(calls[0]!.query.get('finishedAfter')).toBeNull();
      expect(calls[0]!.query.get('tenantId')).toBe(tenantId);
    });

    it.each([
      ['another tenant', { endTime: LATER, tenantId: other }],
      ['an instance still running (an ignored filter)', { endTime: null }],
    ])('refuses an instance of %s', async (_label, fields) => {
      const { engine } = scripted([
        on('GET', '/history/historic-process-instances', () => page([instance(fields)])),
      ]);
      await expect(engine.listEndedInstances(tenant, null, 500)).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
    });
  });

  describe('findTask', () => {
    it('reads one task of the tenant from history, null when unknown', async () => {
      const { engine, calls } = scripted([
        on('GET', '/history/historic-task-instances', (call) =>
          call.query.get('taskId') === 't-1' ? page([task({ endTime: null })]) : page([]),
        ),
      ]);
      expect(await engine.findTask(tenant, 't-1')).toMatchObject({ engineTaskId: 't-1', end: null });
      expect(await engine.findTask(tenant, 't-9')).toBeNull();
      expect(calls[0]!.query.get('tenantId')).toBe(tenantId);
    });

    it.each([
      ['another tenant', { tenantId: other }],
      ['another id (an ignored filter)', { id: 't-2' }],
    ])('refuses a task of %s', async (_label, fields) => {
      const { engine } = scripted([
        on('GET', '/history/historic-task-instances', () => page([task(fields)])),
      ]);
      await expect(engine.findTask(tenant, 't-1')).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
    });
  });

  describe('completeTask', () => {
    it('stores the completion key on the task first, then completes it', async () => {
      const { engine, calls } = scripted([
        on('GET', '/runtime/tasks/t-1', () => ({ status: 200, json: task() })),
        on('POST', '/runtime/tasks/t-1/variables', () => ({ status: 201, json: [] })),
        on('POST', '/runtime/tasks/t-1', () => ({ status: 200 })),
      ]);
      expect(await engine.completeTask(tenant, 't-1', { outcome: 'approve' }, 'key-1')).toBe(
        'completed',
      );
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'GET /runtime/tasks/t-1',
        'POST /runtime/tasks/t-1/variables',
        'POST /runtime/tasks/t-1',
      ]);
      expect(calls[1]!.body).toEqual([
        { name: COMPLETION_KEY_VARIABLE, type: 'string', value: 'key-1', scope: 'local' },
      ]);
      expect(calls[2]!.body).toEqual({
        action: 'complete',
        variables: [{ name: 'outcome', type: 'string', value: 'approve' }],
      });
    });

    it('answers gone for a task that no longer runs, at any step', async () => {
      const gone = scripted([]);
      expect(await gone.engine.completeTask(tenant, 't-1', {}, 'key-1')).toBe('gone');
      const raced = scripted([
        on('GET', '/runtime/tasks/t-1', () => ({ status: 200, json: task() })),
        on('POST', '/runtime/tasks/t-1/variables', () => ({ status: 201, json: [] })),
      ]);
      expect(await raced.engine.completeTask(tenant, 't-1', {}, 'key-1')).toBe('gone');
    });

    it.each([
      ['another tenant', { tenantId: other }],
      ['another id', { id: 't-2' }],
    ])('never touches a task of %s', async (_label, fields) => {
      const { engine, calls } = scripted([
        on('GET', '/runtime/tasks/t-1', () => ({ status: 200, json: task(fields) })),
      ]);
      await expect(engine.completeTask(tenant, 't-1', {}, 'key-1')).rejects.toBeInstanceOf(
        EngineTenantMismatchError,
      );
      expect(calls).toHaveLength(1);
    });
  });

  describe('failures', () => {
    it.each([
      [500, EngineUnavailableError, 'server-error'],
      [503, EngineUnavailableError, 'server-error'],
      [401, EngineUnavailableError, 'unreachable'],
      [400, EngineRefusedError, 'client-error'],
      [409, EngineRefusedError, 'client-error'],
    ] as const)('maps HTTP %d to %p', async (status, type, reason) => {
      const { engine } = scripted([() => ({ status })]);
      const failure = await engine.listOpenTasks(tenant).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(type);
      expect(failure).toMatchObject({ reason });
    });

    it('maps a refused connection to unreachable and never puts the credential in the error', async () => {
      const engine = new FlowableRestEngine(
        { url: 'http://flowable:8080/flowable-rest/service', user: 'core', password: 'secret' },
        (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
      );
      const failure = await engine.listOpenTasks(tenant).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EngineUnavailableError);
      expect(failure).toMatchObject({ reason: 'unreachable' });
      expect(String((failure as Error).message)).not.toContain('secret');
    });
  });
});

describe('instantOfEngine', () => {
  it("reads Flowable's offsets with and without a colon", () => {
    expect(instantOfEngine('2026-10-27T12:00:00.000+0000').toString()).toBe('2026-10-27T12:00:00Z');
    expect(instantOfEngine('2026-10-27T15:30:00.000+03:30').toString()).toBe('2026-10-27T12:00:00Z');
  });
});
