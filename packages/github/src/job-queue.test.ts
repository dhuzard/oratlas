import { describe, expect, it } from "vitest";
import { InMemoryJobQueue } from "./job-queue.js";

/** A promise plus its resolver, for driving worker completion from the test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Yield to the microtask queue a few times so queued follow-on work runs. */
async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe("InMemoryJobQueue", () => {
  it("runs jobs in FIFO order and strictly sequentially with concurrency 1", async () => {
    const startOrder: number[] = [];
    const finishOrder: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const queue = new InMemoryJobQueue<number, number>(async (input) => {
      startOrder.push(input);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      finishOrder.push(input);
      return input * 2;
    });

    const jobs = [1, 2, 3, 4].map((n) => queue.enqueue(n));
    const results = await Promise.all(jobs.map((j) => j.promise));

    expect(startOrder).toEqual([1, 2, 3, 4]);
    expect(finishOrder).toEqual([1, 2, 3, 4]);
    expect(maxInFlight).toBe(1);
    expect(results).toEqual([2, 4, 6, 8]);
    for (const job of jobs) expect(job.status).toBe("succeeded");
  });

  it("does not invoke job N+1's worker until job N settles (concurrency 1)", async () => {
    const gates: Record<number, ReturnType<typeof deferred<void>>> = {
      0: deferred<void>(),
      1: deferred<void>(),
    };
    const started: number[] = [];

    const queue = new InMemoryJobQueue<number, number>(async (input) => {
      started.push(input);
      await gates[input]!.promise;
      return input;
    });

    const first = queue.enqueue(0);
    queue.enqueue(1);

    // Let the first worker start; the second must not have started yet.
    await flushMicrotasks();
    expect(started).toEqual([0]);

    // Settle job 0; only then may job 1's worker be invoked.
    gates[0]!.resolve();
    await first.promise;
    await flushMicrotasks();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve();
    await queue.idle();
  });

  it("runs multiple jobs in flight when concurrency > 1", async () => {
    const gate = deferred<void>();
    let inFlight = 0;
    let maxInFlight = 0;

    const queue = new InMemoryJobQueue<number, number>(
      async (input) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gate.promise;
        inFlight -= 1;
        return input;
      },
      { concurrency: 3 },
    );

    const jobs = [1, 2, 3, 4].map((n) => queue.enqueue(n));
    // Allow the first batch of workers to reach their await point.
    await flushMicrotasks();
    expect(maxInFlight).toBe(3);

    gate.resolve();
    await Promise.all(jobs.map((j) => j.promise));
    expect(maxInFlight).toBe(3);
  });

  it("isolates failures: a failing job rejects but siblings still succeed", async () => {
    const queue = new InMemoryJobQueue<number, number>(async (input) => {
      await Promise.resolve();
      if (input === 2) throw new Error("boom");
      return input * 10;
    });

    const jobs = [1, 2, 3].map((n) => queue.enqueue(n));
    const settled = await Promise.allSettled(jobs.map((j) => j.promise));

    expect(settled[0]).toMatchObject({ status: "fulfilled", value: 10 });
    expect(settled[1]!.status).toBe("rejected");
    expect(settled[2]).toMatchObject({ status: "fulfilled", value: 30 });

    expect(jobs[0]!.status).toBe("succeeded");
    expect(jobs[0]!.result).toBe(10);
    expect(jobs[1]!.status).toBe("failed");
    expect((jobs[1]!.error as Error).message).toBe("boom");
    expect(jobs[2]!.status).toBe("succeeded");
    expect(jobs[2]!.result).toBe(30);

    await queue.idle();
  });

  it("getJob returns handles by id and undefined for unknown ids", async () => {
    const queue = new InMemoryJobQueue<number, number>(async (input) => input);
    const job = queue.enqueue(7);
    expect(queue.getJob(job.id)).toBe(job);
    expect(queue.getJob("job-999")).toBeUndefined();
    await queue.idle();
  });

  it("idle resolves once all jobs have settled", async () => {
    const queue = new InMemoryJobQueue<number, number>(async (input) => {
      await Promise.resolve();
      return input;
    });

    // Idle on an empty queue resolves immediately.
    await queue.idle();

    const jobs = [1, 2, 3].map((n) => queue.enqueue(n));
    await queue.idle();
    for (const job of jobs) expect(job.status).toBe("succeeded");
  });

  it("assigns deterministic monotonic ids from the default factory", async () => {
    const queue = new InMemoryJobQueue<number, number>(async (input) => input);
    const ids = [10, 20, 30].map((n) => queue.enqueue(n).id);
    expect(ids).toEqual(["job-1", "job-2", "job-3"]);
    await queue.idle();
  });

  it("uses an injected id factory when provided", async () => {
    let n = 100;
    const queue = new InMemoryJobQueue<number, number>(async (input) => input, {
      idFactory: () => `custom-${(n += 1)}`,
    });
    expect(queue.enqueue(1).id).toBe("custom-101");
    expect(queue.enqueue(2).id).toBe("custom-102");
    await queue.idle();
  });
});
