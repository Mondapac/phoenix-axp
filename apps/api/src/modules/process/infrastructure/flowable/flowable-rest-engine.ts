// The Flowable REST adapter of the process engine port (ADR-0005 decision 2; ADR-0020 decision 6),
// generalised from the PoC 3 spike (flowable-rest-engine.ts), which ran it against Flowable REST
// 7.1.0 on PostgreSQL.
import { Temporal } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import {
  EngineRefusedError,
  EngineTenantMismatchError,
  EngineUnavailableError,
  type EngineDeployment,
  type EngineInstance,
  type EngineOpenTask,
  type EngineTaskRecord,
  type ProcessEngine,
  type StartCommand,
} from '../../application/ports/process-engine';
import { ENGINE_CALL_TIMEOUT_MS, type EngineVariables } from '../../domain/engine-command';
import type { EngineTaskEnd } from '../../domain/task';

export interface FlowableRestOptions {
  /** `http://flowable:8080/flowable-rest/service`: reachable from the core's network only. */
  readonly url: string;
  /** A credential: never logged. */
  readonly user: string;
  readonly password: string;
}

/** The task-local variable that carries the core's completion key (PoC 3 R4). */
export const COMPLETION_KEY_VARIABLE = 'phoenixCompletionKey';
/** The process variable that names the core instance; the business key says the same. */
export const INSTANCE_VARIABLE = 'phoenixInstanceId';

const PAGE_SIZE = 100;
/** The most open tasks one pass reads; more means the sync cannot keep up and must be told. */
const MAX_OPEN_TASKS = 50_000;

interface Variable {
  readonly name: string;
  readonly value: unknown;
}
interface Page<T> {
  readonly data: T[];
  readonly total: number;
}
interface RestInstance {
  readonly id: string;
  readonly businessKey: string | null;
  readonly startTime: string;
  readonly endTime?: string | null;
  readonly deleteReason?: string | null;
  readonly tenantId: string;
}
interface RestTask {
  readonly id: string;
  readonly processInstanceId: string;
  readonly taskDefinitionKey: string;
  readonly formKey: string | null;
  readonly tenantId: string;
  readonly variables?: Variable[];
}
interface RestHistoricTask extends RestTask {
  readonly endTime: string | null;
  readonly deleteReason: string | null;
}

const variable = (variables: Variable[] | undefined, name: string): string | null => {
  const value = variables?.find((entry) => entry.name === name)?.value;
  return typeof value === 'string' ? value : null;
};

/** Flowable writes offsets as `+0000`; Temporal wants `+00:00`. */
export function instantOfEngine(text: string): Temporal.Instant {
  return Temporal.Instant.from(text.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

/**
 * {@link ProcessEngine} on Flowable's REST API. Every request names the tenant, and every
 * object that comes back is checked against the tenant and against the id or business key asked
 * for: Flowable's REST API ignores query parameters it does not know, so a misspelt filter
 * returns every tenant's rows, and the filter on the wire is never trusted alone. Network
 * errors, timeouts and 5xx are {@link EngineUnavailableError}, retried by the bridge; any other
 * unexpected status is {@link EngineRefusedError}.
 */
export class FlowableRestEngine implements ProcessEngine {
  readonly #authorization: string;

  constructor(
    private readonly options: FlowableRestOptions,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.#authorization =
      'Basic ' + Buffer.from(`${options.user}:${options.password}`).toString('base64');
  }

  async deployRevision(tenant: TenantContext, deployment: EngineDeployment): Promise<void> {
    if ((await this.deploymentOf(tenant, deployment)) !== null) return;
    const form = new FormData();
    form.append(
      'file',
      new Blob([deployment.bpmnXml], { type: 'text/xml' }),
      `${deployment.processKey}.bpmn20.xml`,
    );
    const query = new URLSearchParams({
      tenantId: tenant.tenantId,
      deploymentName: deploymentName(deployment),
    });
    const created = (await this.call('POST', `/repository/deployments?${query.toString()}`, { form })) as {
      tenantId: string;
    };
    this.checkTenant(tenant, created.tenantId);
  }

  async findInstancesByBusinessKey(
    tenant: TenantContext,
    businessKey: string,
  ): Promise<EngineInstance[]> {
    const query = new URLSearchParams({
      businessKey,
      tenantId: tenant.tenantId,
      sort: 'startTime',
      order: 'asc',
      size: String(PAGE_SIZE),
    });
    const page = (await this.call(
      'GET',
      `/history/historic-process-instances?${query.toString()}`,
    )) as Page<RestInstance>;
    return page.data.map((instance) => {
      if (instance.businessKey !== businessKey) throw new EngineTenantMismatchError();
      return this.instanceOf(tenant, instance);
    });
  }

  async startInstance(tenant: TenantContext, command: StartCommand): Promise<EngineInstance> {
    const definitionId = await this.definitionOf(tenant, command);
    const variables = [
      ...variablesOf(command.variables),
      { name: INSTANCE_VARIABLE, type: 'string', value: command.businessKey },
    ];
    const started = (await this.call('POST', '/runtime/process-instances', {
      json: { processDefinitionId: definitionId, businessKey: command.businessKey, variables },
    })) as RestInstance;
    if (started.businessKey !== command.businessKey) throw new EngineTenantMismatchError();
    return this.instanceOf(tenant, started);
  }

  async deleteInstance(
    tenant: TenantContext,
    engineInstanceId: string,
    reason: string,
  ): Promise<void> {
    const path = `/runtime/process-instances/${enc(engineInstanceId)}`;
    const running = (await this.call('GET', path, { allowNotFound: true })) as RestInstance | null;
    if (running === null) return;
    if (running.id !== engineInstanceId) throw new EngineTenantMismatchError();
    this.checkTenant(tenant, running.tenantId);
    await this.call('DELETE', `${path}?${new URLSearchParams({ deleteReason: reason }).toString()}`, {
      allowNotFound: true,
    });
  }

  async listOpenTasks(tenant: TenantContext): Promise<EngineOpenTask[]> {
    const tasks: EngineOpenTask[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      if (start >= MAX_OPEN_TASKS) throw new EngineUnavailableError('too-many');
      const query = new URLSearchParams({
        tenantId: tenant.tenantId,
        includeProcessVariables: 'true',
        sort: 'createTime',
        order: 'asc',
        start: String(start),
        size: String(PAGE_SIZE),
      });
      const page = (await this.call('GET', `/runtime/tasks?${query.toString()}`)) as Page<RestTask>;
      for (const task of page.data) {
        this.checkTenant(tenant, task.tenantId);
        tasks.push(openTaskOf(task));
      }
      if (page.data.length < PAGE_SIZE || start + PAGE_SIZE >= page.total) return tasks;
    }
  }

  listEndedTasks(
    tenant: TenantContext,
    after: Temporal.Instant | null,
    limit: number,
  ): Promise<EngineTaskRecord[]> {
    return this.historicTasks(tenant, after === null ? {} : { taskCompletedAfter: iso(after) }, {
      finished: 'true',
      sort: 'endTime',
      limit,
    });
  }

  async listEndedInstances(
    tenant: TenantContext,
    after: Temporal.Instant | null,
    limit: number,
  ): Promise<EngineInstance[]> {
    const instances: EngineInstance[] = [];
    for (let start = 0; start < limit; start += PAGE_SIZE) {
      const query = new URLSearchParams({
        ...(after === null ? {} : { finishedAfter: iso(after) }),
        finished: 'true',
        tenantId: tenant.tenantId,
        sort: 'endTime',
        order: 'asc',
        start: String(start),
        size: String(Math.min(PAGE_SIZE, limit - start)),
      });
      const page = (await this.call(
        'GET',
        `/history/historic-process-instances?${query.toString()}`,
      )) as Page<RestInstance>;
      for (const instance of page.data) {
        const ended = this.instanceOf(tenant, instance);
        // A filter Flowable ignored would return running instances too.
        if (ended.endedAt === null) throw new EngineTenantMismatchError();
        instances.push(ended);
      }
      if (page.data.length < PAGE_SIZE || start + PAGE_SIZE >= page.total) break;
    }
    return instances;
  }

  async findTask(tenant: TenantContext, engineTaskId: string): Promise<EngineTaskRecord | null> {
    const found = await this.historicTasks(tenant, { taskId: engineTaskId }, { limit: PAGE_SIZE });
    if (found.some((task) => task.engineTaskId !== engineTaskId)) {
      throw new EngineTenantMismatchError();
    }
    return found[0] ?? null;
  }

  async completeTask(
    tenant: TenantContext,
    engineTaskId: string,
    variables: EngineVariables,
    completionKey: string,
  ): Promise<'completed' | 'gone'> {
    const path = `/runtime/tasks/${enc(engineTaskId)}`;
    const task = (await this.call('GET', path, { allowNotFound: true })) as RestTask | null;
    if (task === null) return 'gone';
    if (task.id !== engineTaskId) throw new EngineTenantMismatchError();
    this.checkTenant(tenant, task.tenantId);
    // The key first, on the task itself: history keeps it, so a repeat can tell its own
    // completion from anybody else's.
    const stored = await this.call('POST', `${path}/variables`, {
      json: [{ name: COMPLETION_KEY_VARIABLE, type: 'string', value: completionKey, scope: 'local' }],
      allowNotFound: true,
    });
    if (stored === null) return 'gone';
    const completed = await this.call('POST', path, {
      json: { action: 'complete', variables: variablesOf(variables) },
      allowNotFound: true,
    });
    return completed === null ? 'gone' : 'completed';
  }

  private async historicTasks(
    tenant: TenantContext,
    filter: Record<string, string>,
    options: { readonly finished?: 'true'; readonly sort?: string; readonly limit: number },
  ): Promise<EngineTaskRecord[]> {
    const records: EngineTaskRecord[] = [];
    for (let start = 0; start < options.limit; start += PAGE_SIZE) {
      const query = new URLSearchParams({
        ...filter,
        ...(options.finished === undefined ? {} : { finished: options.finished }),
        tenantId: tenant.tenantId,
        includeTaskLocalVariables: 'true',
        includeProcessVariables: 'true',
        sort: options.sort ?? 'startTime',
        order: 'asc',
        start: String(start),
        size: String(Math.min(PAGE_SIZE, options.limit - start)),
      });
      const page = (await this.call(
        'GET',
        `/history/historic-task-instances?${query.toString()}`,
      )) as Page<RestHistoricTask>;
      for (const task of page.data) {
        this.checkTenant(tenant, task.tenantId);
        const record = taskRecordOf(task);
        if (options.finished !== undefined && record.end === null) {
          throw new EngineTenantMismatchError();
        }
        records.push(record);
      }
      if (page.data.length < PAGE_SIZE || start + PAGE_SIZE >= page.total) break;
    }
    return records;
  }

  private async deploymentOf(
    tenant: TenantContext,
    deployment: Pick<EngineDeployment, 'processKey' | 'revisionId'>,
  ): Promise<string | null> {
    const name = deploymentName(deployment);
    const query = new URLSearchParams({ name, tenantId: tenant.tenantId });
    const page = (await this.call('GET', `/repository/deployments?${query.toString()}`)) as Page<{
      id: string;
      name: string;
      tenantId: string;
    }>;
    for (const entry of page.data) {
      if (entry.name !== name) throw new EngineTenantMismatchError();
      this.checkTenant(tenant, entry.tenantId);
    }
    return page.data[0]?.id ?? null;
  }

  /** The definition of exactly the core's revision: never "the latest" (ADR-0007 V3). */
  private async definitionOf(tenant: TenantContext, command: StartCommand): Promise<string> {
    const deploymentId = await this.deploymentOf(tenant, command);
    if (deploymentId === null) throw new EngineRefusedError('not-deployed');
    const query = new URLSearchParams({
      deploymentId,
      key: command.processKey,
      tenantId: tenant.tenantId,
    });
    const page = (await this.call('GET', `/repository/process-definitions?${query.toString()}`)) as Page<{
      id: string;
      key: string;
      tenantId: string;
      deploymentId: string;
    }>;
    for (const definition of page.data) {
      if (definition.deploymentId !== deploymentId || definition.key !== command.processKey) {
        throw new EngineTenantMismatchError();
      }
      this.checkTenant(tenant, definition.tenantId);
    }
    const definition = page.data[0];
    if (definition === undefined) throw new EngineRefusedError('not-deployed');
    return definition.id;
  }

  private instanceOf(tenant: TenantContext, instance: RestInstance): EngineInstance {
    this.checkTenant(tenant, instance.tenantId);
    const ended = typeof instance.endTime === 'string' ? instance.endTime : null;
    return {
      engineInstanceId: instance.id,
      businessKey: instance.businessKey,
      startedAt: instantOfEngine(instance.startTime),
      endedAt: ended === null ? null : instantOfEngine(ended),
      deleted: typeof instance.deleteReason === 'string',
    };
  }

  private checkTenant(tenant: TenantContext, tenantId: unknown): void {
    if (tenantId !== tenant.tenantId) throw new EngineTenantMismatchError();
  }

  /** One REST call; `null` for a 404 when `allowNotFound`. */
  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: { json?: unknown; form?: FormData; allowNotFound?: boolean } = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.url}${path}`, {
        method,
        headers: {
          authorization: this.#authorization,
          accept: 'application/json',
          ...(body.json === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body.form ?? (body.json === undefined ? undefined : JSON.stringify(body.json)),
        signal: AbortSignal.timeout(ENGINE_CALL_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      throw new EngineUnavailableError(name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
    if (response.status === 404 && body.allowNotFound === true) return null;
    if (response.status >= 500) throw new EngineUnavailableError('server-error');
    if (response.status === 401 || response.status === 403) {
      throw new EngineUnavailableError('unreachable');
    }
    if (!response.ok) throw new EngineRefusedError('client-error');
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new EngineUnavailableError('unreachable');
    }
    if (text.length === 0) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new EngineUnavailableError('server-error');
    }
  }
}

function openTaskOf(task: RestTask): EngineOpenTask {
  return {
    engineTaskId: task.id,
    engineInstanceId: task.processInstanceId,
    taskKey: task.taskDefinitionKey,
    formKey: task.formKey ?? null,
    coreInstanceId: variable(task.variables, INSTANCE_VARIABLE),
  };
}

function taskRecordOf(task: RestHistoricTask): EngineTaskRecord {
  let end: EngineTaskEnd | null = null;
  if (typeof task.endTime === 'string') {
    end =
      typeof task.deleteReason === 'string'
        ? { kind: 'deleted', reason: task.deleteReason }
        : { kind: 'completed', completionKey: variable(task.variables, COMPLETION_KEY_VARIABLE) };
  }
  return {
    ...openTaskOf(task),
    endedAt: typeof task.endTime === 'string' ? instantOfEngine(task.endTime) : null,
    end,
  };
}

/** Typed REST variables: Flowable infers a number as integer or double otherwise. */
function variablesOf(variables: EngineVariables) {
  return Object.entries(variables).map(([name, value]) => ({
    name,
    type: typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : 'long',
    value,
  }));
}

const enc = encodeURIComponent;
const iso = (instant: Temporal.Instant): string => instant.toString({ smallestUnit: 'millisecond' });
const deploymentName = (deployment: Pick<EngineDeployment, 'processKey' | 'revisionId'>) =>
  `${deployment.processKey}@${deployment.revisionId}`;
