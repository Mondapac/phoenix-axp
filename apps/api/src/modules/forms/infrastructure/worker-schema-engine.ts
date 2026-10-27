import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { err, ok } from '@phoenix/shared-kernel';
import type { ContentHash, Result } from '@phoenix/shared-kernel';
import type {
  AnswerProblem,
  AnswerValidator,
  FormSchemaChecker,
  InvalidAnswers,
} from '../application/ports/form-schema-checker';
import { invalidSchema, type InvalidSchema, type JsonObject } from '../domain/form-schema';

/** The reply of the worker (schema-worker.mts repeats it). */
type Reply =
  | { readonly id: number; readonly ok: true }
  | {
      readonly id: number;
      readonly ok: false;
      readonly problem: 'meta-schema' | 'not-compilable';
      readonly pointer?: string;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly problem: 'answers';
      readonly errors: readonly AnswerProblem[];
    };

/** The worker could not answer in time or died; the request is refused, never accepted. */
class WorkerFailure extends Error {
  override readonly name = 'WorkerFailure';
}

/**
 * The limits of the worker thread (security review of slice 2.4, H1): the heap a compile or
 * a validation may use, and how long each may take before the thread is ended and replaced.
 */
export const SCHEMA_WORKER_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
  checkTimeoutMs: 5000,
  validateTimeoutMs: 2000,
});

/** Next to this file: `.ts` under the tests (Node strips the types), `.mjs` in the build. */
const WORKER_FILE = path.join(
  __dirname,
  `schema-worker${path.extname(__filename) === '.ts' ? '.mts' : '.mjs'}`,
);

interface Pending {
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * The form schema engine: Ajv in one worker thread with resource limits, started on first use.
 * Requests are answered in order; one that takes longer than its timeout, or a thread that
 * runs out of memory or crashes, ends the thread and refuses every request it held, and the
 * next request starts a new thread. So a hostile schema or answer costs one refused request,
 * never the API process.
 */
@Injectable()
export class WorkerSchemaEngine
  implements FormSchemaChecker, AnswerValidator, OnApplicationShutdown
{
  readonly #logger = new Logger('WorkerSchemaEngine');
  #worker: Worker | null = null;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;

  async check(dataSchema: JsonObject): Promise<Result<void, InvalidSchema>> {
    try {
      const reply = await this.#request(
        { op: 'check', schema: dataSchema },
        SCHEMA_WORKER_LIMITS.checkTimeoutMs,
      );
      if (reply.ok) return ok(undefined);
      if (reply.problem === 'meta-schema') {
        return invalidSchema('jsonSchema', 'meta-schema', reply.pointer);
      }
      return invalidSchema('jsonSchema', 'not-compilable');
    } catch (error) {
      if (error instanceof WorkerFailure) return invalidSchema('jsonSchema', 'not-compilable');
      throw error;
    }
  }

  async validate(
    revision: { readonly contentHash: ContentHash; readonly jsonSchema: JsonObject },
    answers: JsonObject,
  ): Promise<Result<void, InvalidAnswers>> {
    let reply: Reply;
    try {
      reply = await this.#request(
        { op: 'validate', key: revision.contentHash, schema: revision.jsonSchema, data: answers },
        SCHEMA_WORKER_LIMITS.validateTimeoutMs,
      );
    } catch (error) {
      if (!(error instanceof WorkerFailure)) throw error;
      return err({
        code: 'forms.submission.invalid',
        problems: [{ pointer: '', keyword: 'limit' }],
      });
    }
    if (reply.ok) return ok(undefined);
    const problems =
      reply.problem === 'answers' ? reply.errors : [{ pointer: '', keyword: 'schema' }];
    return err({ code: 'forms.submission.invalid', problems });
  }

  onApplicationShutdown(): void {
    this.#end(new WorkerFailure('the application is shutting down'));
  }

  #request(message: object, timeoutMs: number): Promise<Reply> {
    const worker = this.#ensure();
    const id = this.#nextId++;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#logger.warn(`A schema request ran past ${timeoutMs} ms; the worker is replaced`);
        this.#end(new WorkerFailure('timed out'));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, ...message });
    });
  }

  #ensure(): Worker {
    if (this.#worker !== null) return this.#worker;
    const { maxOldGenerationSizeMb, maxYoungGenerationSizeMb, stackSizeMb } = SCHEMA_WORKER_LIMITS;
    const worker = new Worker(WORKER_FILE, {
      resourceLimits: { maxOldGenerationSizeMb, maxYoungGenerationSizeMb, stackSizeMb },
      // The worker needs no environment: nothing secret reaches it.
      env: {},
      stdout: false,
      stderr: false,
    });
    worker.unref();
    worker.on('message', (reply: Reply) => {
      const pending = this.#pending.get(reply.id);
      if (pending === undefined) return;
      this.#pending.delete(reply.id);
      clearTimeout(pending.timer);
      pending.resolve(reply);
    });
    worker.on('error', (error: Error) => {
      this.#logger.warn(`The schema worker failed (${error.name}); it is replaced`);
      if (this.#worker === worker) this.#end(new WorkerFailure('failed'));
    });
    worker.on('exit', () => {
      if (this.#worker === worker) this.#end(new WorkerFailure('exited'));
    });
    this.#worker = worker;
    return worker;
  }

  #end(reason: WorkerFailure): void {
    const worker = this.#worker;
    this.#worker = null;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      this.#pending.delete(id);
    }
    if (worker !== null) void worker.terminate();
  }
}
