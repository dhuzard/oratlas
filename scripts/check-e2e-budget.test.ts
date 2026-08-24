import { describe, expect, it } from "vitest";
import { aggregateE2eReports, evaluateE2eReport } from "./check-e2e-budget";

describe("E2E timing and flake budget", () => {
  it("accepts a clean run within the wall-time budget", () => {
    expect(
      evaluateE2eReport(
        { stats: { duration: 239_000, expected: 42, skipped: 1, unexpected: 0, flaky: 0 } },
        300_000,
      ),
    ).toMatchObject({ durationMs: 239_000, expected: 42, errors: [] });
  });

  it("rejects slow, flaky, or unexpectedly failing runs", () => {
    const result = evaluateE2eReport(
      { stats: { duration: 301_000, expected: 40, skipped: 0, unexpected: 1, flaky: 1 } },
      300_000,
    );
    expect(result.errors).toEqual([
      "E2E wall time 301000ms exceeds the 300000ms budget.",
      "1 test(s) passed only after a retry and are classified as flaky.",
      "1 test(s) have an unexpected final result.",
    ]);
  });

  it("fails closed when timing statistics are absent", () => {
    expect(() => evaluateE2eReport({})).toThrow(/duration statistics/);
  });

  it("aggregates every shard before enforcing the suite budget", () => {
    const report = aggregateE2eReports([
      { stats: { duration: 120_000, expected: 42, skipped: 0, unexpected: 0, flaky: 0 } },
      { stats: { duration: 119_000, expected: 39, skipped: 1, unexpected: 0, flaky: 0 } },
    ]);

    expect(evaluateE2eReport(report, 300_000)).toMatchObject({
      durationMs: 239_000,
      expected: 81,
      skipped: 1,
      unexpected: 0,
      flaky: 0,
      errors: [],
    });
  });

  it("fails closed when any shard report is malformed", () => {
    expect(() => aggregateE2eReports([{ stats: { duration: 1 } }, {}])).toThrow(
      /duration statistics/,
    );
  });
});
