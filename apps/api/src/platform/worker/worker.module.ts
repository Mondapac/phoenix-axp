import { Module } from '@nestjs/common';
import { WorkerRuntime } from './worker-runtime';

/** Provides the worker runtime; only `start-worker.ts` starts it. */
@Module({
  providers: [{ provide: WorkerRuntime, useFactory: () => new WorkerRuntime() }],
  exports: [WorkerRuntime],
})
export class WorkerModule {}
