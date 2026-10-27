import type { TenantContext } from '@phoenix/shared-kernel';
import {
  EngineTenantMismatchError,
  EngineUnavailableError,
  type EngineDeployment,
  type EngineInstance,
  type EngineOpenTask,
  type EngineTaskRecord,
  type ProcessEngine,
  type StartCommand,
} from '../../application/ports/process-engine';
import { isDecision, type Decision, type EngineTaskEnd } from '../../domain/task';

export interface FlowableRestOptions {
  /** `http://flowable:8080/flowable-rest/service`, reachable from the core's network only. */
  readonly baseUrl: string;
  readonly user: string;
  readonly password: string;
  /** Per call. The relay's lease must be longer. */
  readonly timeoutMs: number;
}

/** The task-local variable that carries the core's completion key (the outbox event id). */
export const COMPLETION_KEY_VARIABLE = 'phoenixCompletionKey';
const PAGE_SIZE = 100;

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
  readonly variables?: Variable[];
}
interface RestTask {
  readonly id: string;
  readonly processInstanceId: string;
  readonly taskDefinitionKey: string;
  readonly formKey: string | null;
  readonly assignee: string | null;
  readonly tenantId: string;
  readonly variables?: Variable[];
}
interface RestHistoricTask extends RestTask {
  readonly endTime: string | null;
  readonly deleteReason: string | null;
}

const variable = (variables: Variable[] | undefined, name: string): unknown =>
  variables?.find((entry) => entry.name === name)?.value;

/**
 * The Flowable REST adapter of {@link ProcessEngine} (ADR-0005 decision 2). Every request names
 * the tenant, and every object that comes back is checked against it: Flowable's REST API
 * ignores query parameters it does not know (a misspelt filter returns every tenant's rows), so
 * the filter on the wire is never trusted alone. Network errors, timeouts and 5xx become
 * {@link EngineUnavailableError}, which the bridge retries.
 */
export class FlowableRestEngine implements ProcessEngine {
  private readonly authorization: string;

  constructor(private readonly options: FlowableRestOptions) {
    this.authorization =
      'Basic ' + Buffer.from(`${options.user}:${options.password}`).toString('base64');
  }

  async deployRevision(tenant: TenantContext, revision: EngineDeployment): Promise<void> {
    if ((await this.deploymentOf(tenant, revision)) !== null) return;
    const form = new FormData();
    form.append(
      'file',
      new Blob([revision.bpmnXml], { type: 'text/xml' }),
      `${revision.processKey}.bpmn20.xml`,
    );
    const query = new URLSearchParams({
      tenantId: tenant.tenantId,
      deploymentName: deploymentName(revision),
    });
    await this.call('POST', `/repository/deployments?${query.toString()}`, { form });
  }

  async findInstancesByBusinessKey(
    tenant: TenantContext,
    businessKey: string,
  ): Promise<EngineInstance[]> {
    const query = new URLSearchParams({
      businessKey,
      tenantId: tenant.tenantId,
      includeProcessVariables: 'true',
      sort: 'startTime',
      order: 'asc',
      size: String(PAGE_SIZE),
    });
    const page = (await this.call(
      'GET',
      `/history/historic-process-instances?${query.toString()}`,
    )) as Page<RestInstance>;
    return page.data
      .map((instance) => this.instanceOf(tenant, instance))
      .filter((instance) => instance.businessKey === businessKey);
  }

  async startInstance(tenant: TenantContext, command: StartCommand): Promise<EngineInstance> {
    const definitionId = await this.definitionOf(tenant, command);
    const body = {
      processDefinitionId: definitionId,
      businessKey: command.businessKey,
      variables: Object.entries(command.variables).map(([name, value]) => ({ name, value })),
    };
    const started = (await this.call('POST', '/runtime/process-instances', {
      json: body,
    })) as RestInstance;
    return this.instanceOf(tenant, started);
  }

  async findInstance(tenant: TenantContext, instanceId: string): Promise<EngineInstance | null> {
    const query = new URLSearchParams({
      processInstanceId: instanceId,
      tenantId: tenant.tenantId,
      includeProcessVariables: 'true',
    });
    const page = (await this.call(
      'GET',
      `/history/historic-process-instances?${query.toString()}`,
    )) as Page<RestInstance>;
    const found = page.data.find((instance) => instance.id === instanceId);
    return found === undefined ? null : this.instanceOf(tenant, found);
  }

  async deleteInstance(tenant: TenantContext, instanceId: string, reason: string): Promise<void> {
    const running = (await this.call('GET', `/runtime/process-instances/${enc(instanceId)}`, {
      allowNotFound: true,
    })) as RestInstance | null;
    if (running === null) return;
    this.checkTenant(tenant, running.tenantId);
    const query = new URLSearchParams({ deleteReason: reason });
    await this.call('DELETE', `/runtime/process-instances/${enc(instanceId)}?${query.toString()}`, {
      allowNotFound: true,
    });
  }

  async listOpenTasks(tenant: TenantContext): Promise<EngineOpenTask[]> {
    const tasks: EngineOpenTask[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
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
        const requestId = variable(task.variables, 'requestId');
        tasks.push({
          engineTaskId: task.id,
          processInstanceId: task.processInstanceId,
          taskKey: task.taskDefinitionKey,
          formKey: task.formKey,
          assigneeId: task.assignee,
          requestId: typeof requestId === 'string' ? requestId : null,
        });
      }
      if (page.data.length < PAGE_SIZE || start + PAGE_SIZE >= page.total) return tasks;
    }
  }

  async findTask(tenant: TenantContext, engineTaskId: string): Promise<EngineTaskRecord | null> {
    const found = await this.historicTasks(tenant, { taskId: engineTaskId });
    return found.find((task) => task.engineTaskId === engineTaskId) ?? null;
  }

  async listInstanceTasks(tenant: TenantContext, instanceId: string): Promise<EngineTaskRecord[]> {
    const found = await this.historicTasks(tenant, { processInstanceId: instanceId });
    return found.filter((task) => task.processInstanceId === instanceId);
  }

  private async historicTasks(
    tenant: TenantContext,
    filter: Record<string, string>,
  ): Promise<EngineTaskRecord[]> {
    const query = new URLSearchParams({
      ...filter,
      tenantId: tenant.tenantId,
      includeTaskLocalVariables: 'true',
      sort: 'startTime',
      order: 'asc',
      size: String(PAGE_SIZE),
    });
    const page = (await this.call(
      'GET',
      `/history/historic-task-instances?${query.toString()}`,
    )) as Page<RestHistoricTask>;
    return page.data.map((task) => {
      this.checkTenant(tenant, task.tenantId);
      let end: EngineTaskEnd | null = null;
      if (task.endTime !== null) {
        const key = variable(task.variables, COMPLETION_KEY_VARIABLE);
        end =
          task.deleteReason === null
            ? { kind: 'completed', completionKey: typeof key === 'string' ? key : null }
            : { kind: 'deleted', reason: task.deleteReason };
      }
      return {
        engineTaskId: task.id,
        processInstanceId: task.processInstanceId,
        taskKey: task.taskDefinitionKey,
        formKey: task.formKey,
        assigneeId: task.assignee,
        end,
      };
    });
  }

  async completeTask(
    tenant: TenantContext,
    engineTaskId: string,
    decision: Decision,
    completionKey: string,
  ): Promise<'completed' | 'gone'> {
    const path = `/runtime/tasks/${enc(engineTaskId)}`;
    const task = (await this.call('GET', path, { allowNotFound: true })) as RestTask | null;
    if (task === null) return 'gone';
    this.checkTenant(tenant, task.tenantId);
    // The key first, on the task itself: history keeps it, so a repeat can tell its own
    // completion from anybody else's.
    const stored = await this.call('POST', `${path}/variables`, {
      json: [{ name: COMPLETION_KEY_VARIABLE, value: completionKey, scope: 'local' }],
      allowNotFound: true,
    });
    if (stored === null) return 'gone';
    const completed = await this.call('POST', path, {
      json: { action: 'complete', variables: [{ name: 'decision', value: decision }] },
      allowNotFound: true,
    });
    return completed === null ? 'gone' : 'completed';
  }

  private async deploymentOf(
    tenant: TenantContext,
    revision: Pick<EngineDeployment, 'processKey' | 'revisionId'>,
  ): Promise<string | null> {
    const name = deploymentName(revision);
    const query = new URLSearchParams({ name, tenantId: tenant.tenantId });
    const page = (await this.call('GET', `/repository/deployments?${query.toString()}`)) as Page<{
      id: string;
      name: string;
      tenantId: string;
    }>;
    const found = page.data.find((entry) => entry.name === name);
    if (found === undefined) return null;
    this.checkTenant(tenant, found.tenantId);
    return found.id;
  }

  /** The definition of exactly the core's revision: never "the latest" (ADR-0007 V3). */
  private async definitionOf(tenant: TenantContext, command: StartCommand): Promise<string> {
    const deploymentId = await this.deploymentOf(tenant, command);
    if (deploymentId === null) throw new Error('The process revision is not deployed');
    const query = new URLSearchParams({ deploymentId, key: command.processKey });
    const page = (await this.call(
      'GET',
      `/repository/process-definitions?${query.toString()}`,
    )) as Page<{
      id: string;
      tenantId: string;
      deploymentId: string;
    }>;
    const definition = page.data.find((entry) => entry.deploymentId === deploymentId);
    if (definition === undefined) throw new Error('The deployment has no such process');
    this.checkTenant(tenant, definition.tenantId);
    return definition.id;
  }

  private instanceOf(tenant: TenantContext, instance: RestInstance): EngineInstance {
    this.checkTenant(tenant, instance.tenantId);
    const decision = variable(instance.variables, 'decision');
    return {
      instanceId: instance.id,
      businessKey: instance.businessKey,
      startedAt: instance.startTime,
      ended: instance.endTime !== undefined && instance.endTime !== null,
      deleted: instance.deleteReason !== undefined && instance.deleteReason !== null,
      decision: isDecision(decision) ? decision : null,
    };
  }

  private checkTenant(tenant: TenantContext, tenantId: string): void {
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
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authorization,
          ...(body.json === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body.form ?? (body.json === undefined ? undefined : JSON.stringify(body.json)),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      throw new EngineUnavailableError(name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
    if (response.status === 404 && body.allowNotFound === true) return null;
    if (response.status >= 500) throw new EngineUnavailableError('server-error');
    if (!response.ok) throw new EngineUnavailableError('unexpected-status');
    const text = await response.text();
    return text.length === 0 ? {} : (JSON.parse(text) as unknown);
  }
}

const enc = encodeURIComponent;
const deploymentName = (revision: Pick<EngineDeployment, 'processKey' | 'revisionId'>) =>
  `${revision.processKey}@${revision.revisionId}`;
