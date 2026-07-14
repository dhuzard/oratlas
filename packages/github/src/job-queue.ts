/**
 * Generic in-process async job queue.
 *
 * This models the "a real deployment would use a broker" seam. The POC runs
 * jobs in-process with a bounded concurrency; a production deployment would
 * swap this for a Redis/BullMQ (or SQS/Cloud Tasks) worker satisfying the same
 * conceptual contract:
 *
 *   - `enqueue(input)` persists a job and returns a handle synchronously.
 *   - a worker function `(input) => Promise<result>` processes jobs off the
 *     queue, respecting a concurrency cap.
 *   - each job carries an id, a status lifecycle, and a settled result/error.
 *   - one job failing never stalls or rejects sibling jobs (failure isolation).
 *
 * Everything here is framework-free: no timers, no globals, no external deps.
 * Ids are produced by an injectable factory (default: a monotonic counter) so
 * behaviour is deterministic and testable.
 */

/** Lifecycle of a single job. */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * A handle to an enqueued job. Returned synchronously from `enqueue`; its
 * fields are mutated in place as the job progresses, and `promise` settles when
 * the job reaches a terminal state.
 */
export interface Job<TInput, TResult> {
  readonly id: string;
  readonly input: TInput;
  status: JobStatus;
  result?: TResult;
  error?: unknown;
  /** Resolves with the result on success, rejects with the error on failure. */
  readonly promise: Promise<TResult>;
}

/** The worker that processes each job's input into a result. */
export type JobWorker<TInput, TResult> = (input: TInput) => Promise<TResult>;

export interface InMemoryJobQueueOptions {
  /** Maximum number of jobs running concurrently. Default 1 (strictly serial). */
  concurrency?: number;
  /** Injectable id factory; defaults to a monotonic "job-N" counter. */
  idFactory?: () => string;
}

/** Default id factory: a monotonic counter yielding "job-1", "job-2", … */
function createMonotonicIdFactory(): () => string {
  let n = 0;
  return () => `job-${(n += 1)}`;
}

/**
 * In-process, bounded-concurrency job queue. This is the POC implementation of
 * the broker seam described in the module doc comment.
 */
export class InMemoryJobQueue<TInput, TResult> {
  private readonly concurrency: number;
  private readonly nextId: () => string;
  private readonly worker: JobWorker<TInput, TResult>;

  /** Internal job records, keyed by id. */
  private readonly jobs = new Map<string, Job<TInput, TResult>>();
  /** FIFO backlog of jobs awaiting a worker slot. */
  private readonly pending: Array<InternalJob<TInput, TResult>> = [];
  /** Count of jobs currently in the "running" state. */
  private running = 0;
  /** Resolvers waiting on `idle()` to be notified when the queue drains. */
  private idleWaiters: Array<() => void> = [];

  constructor(worker: JobWorker<TInput, TResult>, options: InMemoryJobQueueOptions = {}) {
    this.worker = worker;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.nextId = options.idFactory ?? createMonotonicIdFactory();
  }

  /**
   * Enqueue a job. Assigns an id, records it as "queued", schedules processing
   * subject to the concurrency cap, and returns the handle synchronously. The
   * worker for this job is not invoked until a slot is free and all earlier
   * queued jobs have started (FIFO).
   */
  enqueue(input: TInput): Job<TInput, TResult> {
    const id = this.nextId();
    let resolve!: (value: TResult) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<TResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // A settled promise must never surface as an unhandled rejection just
    // because a caller chose not to await it; attach a no-op sink.
    promise.catch(() => {});

    const job: InternalJob<TInput, TResult> = {
      id,
      input,
      status: "queued",
      promise,
      resolve,
      reject,
    };
    this.jobs.set(id, job);
    this.pending.push(job);
    this.pump();
    return job;
  }

  /** Return the job with the given id, or undefined if unknown. */
  getJob(id: string): Job<TInput, TResult> | undefined {
    return this.jobs.get(id);
  }

  /** Resolves once no jobs are queued or running. */
  idle(): Promise<void> {
    if (this.pending.length === 0 && this.running === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Start as many pending jobs as the concurrency cap allows. */
  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.running += 1;
      job.status = "running";
      // Invoke the worker inside the microtask chain of a resolved promise so
      // that enqueue returns before any worker body runs, while preserving
      // FIFO start order for same-tick enqueues.
      void this.runJob(job);
    }
  }

  private async runJob(job: InternalJob<TInput, TResult>): Promise<void> {
    try {
      // Defer the worker body out of the synchronous `enqueue`/`pump` call
      // stack so `enqueue` always returns before any work runs.
      await Promise.resolve();
      const result = await this.worker(job.input);
      job.status = "succeeded";
      job.result = result;
      job.resolve(result);
    } catch (error) {
      // Failure isolation: record and reject only this job; the queue keeps
      // draining its siblings.
      job.status = "failed";
      job.error = error;
      job.reject(error);
    } finally {
      this.running -= 1;
      this.pump();
      this.notifyIfIdle();
    }
  }

  private notifyIfIdle(): void {
    if (this.pending.length === 0 && this.running === 0 && this.idleWaiters.length > 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }
}

/** Internal job record: the public handle plus its promise settlers. */
interface InternalJob<TInput, TResult> extends Job<TInput, TResult> {
  resolve: (value: TResult) => void;
  reject: (reason: unknown) => void;
}
