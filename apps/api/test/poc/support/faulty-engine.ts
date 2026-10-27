import {
  EngineUnavailableError,
  type ProcessEngine,
} from '../../../src/modules/process/application/ports/process-engine';

type Method = keyof ProcessEngine;

/**
 * A {@link ProcessEngine} decorator that injects the failures of the PoC matrix around the real
 * Flowable adapter, and counts the calls that reached the engine.
 *
 * - `down`: every call fails as if Flowable refused the connection.
 * - `dieBefore` / `dieAfter`: the call never settles, before reaching the engine or after the
 *   engine has done its work. The caller is abandoned, as a worker killed at that point would
 *   be: nothing after the call runs, and the outbox row keeps its lease.
 * - `delayBefore`: waits before calling through (a slow worker or a slow network).
 */
export class FaultyEngine implements ProcessEngine {
  down = false;
  readonly dieBefore = new Set<Method>();
  readonly dieAfter = new Set<Method>();
  readonly delayBefore = new Map<Method, number>();
  /** Calls that reached the real engine, per method. */
  readonly calls = new Map<Method, number>();
  /** Set when a call was abandoned by `dieBefore` or `dieAfter`. */
  readonly died: Method[] = [];

  constructor(private readonly real: ProcessEngine) {}

  reset(): void {
    this.down = false;
    this.dieBefore.clear();
    this.dieAfter.clear();
    this.delayBefore.clear();
    this.calls.clear();
    this.died.length = 0;
  }

  callsTo(method: Method): number {
    return this.calls.get(method) ?? 0;
  }

  deployRevision: ProcessEngine['deployRevision'] = (...args) =>
    this.around('deployRevision', () => this.real.deployRevision(...args));
  findInstancesByBusinessKey: ProcessEngine['findInstancesByBusinessKey'] = (...args) =>
    this.around('findInstancesByBusinessKey', () => this.real.findInstancesByBusinessKey(...args));
  startInstance: ProcessEngine['startInstance'] = (...args) =>
    this.around('startInstance', () => this.real.startInstance(...args));
  findInstance: ProcessEngine['findInstance'] = (...args) =>
    this.around('findInstance', () => this.real.findInstance(...args));
  deleteInstance: ProcessEngine['deleteInstance'] = (...args) =>
    this.around('deleteInstance', () => this.real.deleteInstance(...args));
  listOpenTasks: ProcessEngine['listOpenTasks'] = (...args) =>
    this.around('listOpenTasks', () => this.real.listOpenTasks(...args));
  findTask: ProcessEngine['findTask'] = (...args) =>
    this.around('findTask', () => this.real.findTask(...args));
  listInstanceTasks: ProcessEngine['listInstanceTasks'] = (...args) =>
    this.around('listInstanceTasks', () => this.real.listInstanceTasks(...args));
  completeTask: ProcessEngine['completeTask'] = (...args) =>
    this.around('completeTask', () => this.real.completeTask(...args));

  private async around<T>(method: Method, call: () => Promise<T>): Promise<T> {
    if (this.down) throw new EngineUnavailableError('unreachable');
    const delay = this.delayBefore.get(method);
    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.dieBefore.has(method)) return this.die(method);
    this.calls.set(method, this.callsTo(method) + 1);
    const result = await call();
    if (this.dieAfter.has(method)) return this.die(method);
    return result;
  }

  private die(method: Method): Promise<never> {
    this.died.push(method);
    return new Promise<never>(() => undefined);
  }
}
