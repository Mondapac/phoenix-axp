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
  // A validation may compile its revision first (the worker's cache is cold after a restart
  // and holds 64 revisions), so it has the same budget as a check (security review M1).
  validateTimeoutMs: 5000,
  /** Requests waiting for the worker; more are refused at once, as over the limit. */
  maxQueued: 256,
});

/** Next to this file: `.ts` under the tests (Node strips the types), `.mjs` in the build. */
const WORKER_FILE = path.join(
  __dirname,
  `schema-worker${path.extname(__filename) === '.ts' ? '.mts' : '.mjs'}`,
);

interface Queued {
  readonly message: object;
  readonly timeoutMs: number;
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: Error) => void;
}

interface InFlight extends Queued {
  readonly id: number;
  readonly timer: NodeJS.Timeout;
}

/**
 * The form schema engine: Ajv in one worker thread with resource limits, started on first use.
 * One request runs at a time, the others wait in order on this side, and a request's timeout
 * starts only when the worker takes it (security review M1). A request that takes longer than
 * its timeout, or a thread that runs out of memory or crashes, ends the thread and refuses that
 * request only; the next request starts a new thread. So a hostile schema or answer costs one
 * refused request, never the API process or the requests queued behind it.
 */
@Injectable()
export class WorkerSchemaEngine
  implements FormSchemaChecker, AnswerValidator, OnApplicationShutdown
{
  readonly #logger = new Logger('WorkerSchemaEngine');
  #worker: Worker | null = null;
  readonly #queue: Queued[] = [];
  #inFlight: InFlight | null = null;
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
    const reason = new WorkerFailure('the application is shutting down');
    for (const queued of this.#queue.splice(0)) queued.reject(reason);
    this.#fail(reason);
  }

  #request(message: object, timeoutMs: number): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      if (this.#queue.length >= SCHEMA_WORKER_LIMITS.maxQueued) {
        reject(new WorkerFailure('too many requests waiting'));
        return;
      }
      this.#queue.push({ message, timeoutMs, resolve, reject });
      this.#next();
    });
  }

  /** Hands the next waiting request to the worker, when none is running. */
  #next(): void {
    if (this.#inFlight !== null) return;
    const queued = this.#queue.shift();
    if (queued === undefined) return;
    const worker = this.#ensure();
    const id = this.#nextId++;
    const timer = setTimeout(() => {
      this.#logger.warn(`A schema request ran past ${queued.timeoutMs} ms; the worker is replaced`);
      this.#fail(new WorkerFailure('timed out'));
    }, queued.timeoutMs);
    this.#inFlight = { ...queued, id, timer };
    worker.postMessage({ id, ...queued.message });
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
      const running = this.#inFlight;
      if (this.#worker !== worker || running === null || running.id !== reply.id) return;
      this.#inFlight = null;
      clearTimeout(running.timer);
      running.resolve(reply);
      this.#next();
    });
    worker.on('error', (error: Error) => {
      this.#logger.warn(`The schema worker failed (${error.name}); it is replaced`);
      if (this.#worker === worker) this.#fail(new WorkerFailure('failed'));
    });
    worker.on('exit', () => {
      if (this.#worker === worker) this.#fail(new WorkerFailure('exited'));
    });
    this.#worker = worker;
    return worker;
  }

  /** Ends the thread and refuses the running request; the waiting ones go to a new thread. */
  #fail(reason: WorkerFailure): void {
    const worker = this.#worker;
    const running = this.#inFlight;
    this.#worker = null;
    this.#inFlight = null;
    if (running !== null) {
      clearTimeout(running.timer);
      running.reject(reason);
    }
    if (worker !== null) void worker.terminate();
    this.#next();
  }
}
