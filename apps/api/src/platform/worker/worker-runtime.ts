import { Logger } from '@nestjs/common';

/** The worker's liveness line. */
export const HEARTBEAT_MS = 60_000;

/**
 * What the `worker` role runs. In Phase 0 there is no background work yet: the outbox relay,
 * the event dispatcher and the scheduler are deferred (docs/platform-deferred.md), so the
 * runtime only proves the role boots, passes the start-up self-checks, logs a heartbeat and
 * stops cleanly. `main.ts` calls {@link start}; no lifecycle hook starts a timer, so building
 * the graph in a test starts nothing.
 */
export class WorkerRuntime {
  private readonly logger = new Logger('WorkerRuntime');
  private heartbeat: NodeJS.Timeout | undefined;

  get running(): boolean {
    return this.heartbeat !== undefined;
  }

  start(): void {
    if (this.heartbeat !== undefined) return;
    this.heartbeat = setInterval(() => this.logger.log({ msg: 'worker.heartbeat' }), HEARTBEAT_MS);
    this.logger.log({ msg: 'worker.started' });
  }

  stop(): void {
    if (this.heartbeat === undefined) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.logger.log({ msg: 'worker.stopped' });
  }
}
