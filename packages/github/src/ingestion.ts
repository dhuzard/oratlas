import { type InspectionReport } from "@oratlas/contracts";
import { inspectRepository, type InspectOptions } from "./inspect.js";

/**
 * Ingestion abstraction (spec §6). The POC runs inspection synchronously behind
 * this interface so a queue/worker can replace it later without touching
 * callers. `enqueue` returns the finished report today; a real implementation
 * would return a job handle and complete asynchronously.
 */
export interface IngestionRunner {
  run(input: string, options?: InspectOptions): Promise<InspectionReport>;
}

export class SynchronousIngestionRunner implements IngestionRunner {
  constructor(private readonly defaults: InspectOptions = {}) {}

  run(input: string, options: InspectOptions = {}): Promise<InspectionReport> {
    return inspectRepository(input, { ...this.defaults, ...options });
  }
}
