import { type InspectionReport } from "@oratlas/contracts";
import { inspectRepository, type InspectOptions } from "./inspect.js";
import { InMemoryJobQueue, type JobStatus } from "./job-queue.js";

/**
 * A handle to an asynchronously enqueued ingestion. Mirrors the shape a real
 * broker-backed runner would return: an id, a status lifecycle, the finished
 * report (once succeeded), an error message (once failed), and a `completion`
 * promise that settles with the report or rejects.
 */
export interface IngestionJob {
  id: string;
  status: JobStatus;
  report?: InspectionReport;
  error?: string;
  completion: Promise<InspectionReport>;
}

/**
 * Ingestion abstraction (spec §6). The POC runs inspection in-process behind
 * this interface so a queue/worker can replace it later without touching
 * callers. `run` inspects synchronously and awaits the report; `enqueue`
 * returns a job handle immediately and completes asynchronously via an
 * in-process job queue (the seam a Redis/BullMQ worker would satisfy).
 */
export interface IngestionRunner {
  run(input: string, options?: InspectOptions): Promise<InspectionReport>;
  enqueue(input: string, options?: InspectOptions): IngestionJob;
}

/** Input the internal job queue carries for each enqueued ingestion. */
interface IngestionJobInput {
  input: string;
  options: InspectOptions;
}

export class SynchronousIngestionRunner implements IngestionRunner {
  private readonly queue: InMemoryJobQueue<IngestionJobInput, InspectionReport>;

  constructor(private readonly defaults: InspectOptions = {}) {
    this.queue = new InMemoryJobQueue<IngestionJobInput, InspectionReport>(({ input, options }) =>
      inspectRepository(input, { ...this.defaults, ...options }),
    );
  }

  run(input: string, options: InspectOptions = {}): Promise<InspectionReport> {
    return inspectRepository(input, { ...this.defaults, ...options });
  }

  enqueue(input: string, options: InspectOptions = {}): IngestionJob {
    const job = this.queue.enqueue({ input, options });
    // Expose a live view over the queue's job whose status/report/error track
    // the underlying job as it settles.
    const handle: IngestionJob = {
      id: job.id,
      status: job.status,
      completion: job.promise,
    };
    job.promise.then(
      (report) => {
        handle.status = "succeeded";
        handle.report = report;
      },
      (error: unknown) => {
        handle.status = "failed";
        handle.error = error instanceof Error ? error.message : String(error);
      },
    );
    return handle;
  }
}
