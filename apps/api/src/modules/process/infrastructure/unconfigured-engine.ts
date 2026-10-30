import { EngineUnavailableError, type ProcessEngine } from '../application/ports/process-engine';

const unavailable = (): Promise<never> =>
  Promise.reject(new EngineUnavailableError('unconfigured'));

/**
 * The engine port when `FLOWABLE_*` is unset (development and tests without Flowable): every
 * call fails as unavailable, so commands wait and the sync changes nothing. Production refuses
 * to start without Flowable (app-config).
 */
export class UnconfiguredEngine implements ProcessEngine {
  deployRevision = unavailable;
  deployDecision = unavailable;
  findInstancesByBusinessKey = unavailable;
  startInstance = unavailable;
  deleteInstance = unavailable;
  listOpenTasks = unavailable;
  listEndedTasks = unavailable;
  listEndedInstances = unavailable;
  findTask = unavailable;
  completeTask = unavailable;
}
