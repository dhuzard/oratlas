import { describe, expect, it } from "vitest";
import {
  aggregateE2eReports,
  collectNonPassingTests,
  E2E_WALL_TIME_BUDGET_MS,
  evaluateE2eReport,
  formatNonPassingTests,
} from "./check-e2e-budget";

describe("E2E timing and flake budget", () => {
  it("keeps the 83-journey suite under a bounded 9.75-minute ceiling", () => {
    expect(E2E_WALL_TIME_BUDGET_MS).toBe(585_000);
  });

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

  describe("naming the tests behind a failing gate", () => {
    const flaky = {
      title: "editor can sign in",
      file: "editorial.spec.ts",
      line: 13,
      tests: [
        {
          status: "flaky",
          results: [
            {
              status: "timedOut",
              retry: 0,
              error: {
                message: "\u001b[31mTest timeout of 90000ms exceeded.\u001b[39m\nstack line",
              },
            },
            { status: "passed", retry: 1 },
          ],
        },
      ],
    };
    const unexpected = {
      title: "exports are bounded",
      file: "exports.spec.ts",
      line: 7,
      tests: [
        {
          status: "unexpected",
          results: [{ status: "failed", retry: 0, error: { message: "x".repeat(400) } }],
        },
      ],
    };
    const report = {
      stats: { duration: 1, expected: 2, skipped: 0, unexpected: 1, flaky: 1 },
      suites: [
        {
          title: "editorial.spec.ts",
          suites: [{ title: "Editorial workflow (mock auth)", specs: [flaky] }],
        },
        { title: "exports.spec.ts", specs: [unexpected] },
        {
          title: "ok.spec.ts",
          specs: [
            {
              title: "fine",
              file: "ok.spec.ts",
              line: 1,
              tests: [{ status: "expected", results: [{ status: "passed", retry: 0 }] }],
            },
          ],
        },
      ],
    };

    it("lists flaky and unexpected tests with file, line, describe path and first error line", () => {
      const found = collectNonPassingTests(report);
      expect(found.map((t) => [t.status, `${t.file}:${t.line}`, t.title])).toEqual([
        ["flaky", "editorial.spec.ts:13", "Editorial workflow (mock auth) › editor can sign in"],
        ["unexpected", "exports.spec.ts:7", "exports are bounded"],
      ]);
      expect(found[0]?.failedAttempts).toEqual([
        { retry: 0, message: "Test timeout of 90000ms exceeded." },
      ]);
    });

    it("truncates long messages and never includes later (stack) lines", () => {
      const message = collectNonPassingTests(report)[1]?.failedAttempts[0]?.message ?? "";
      expect(message.length).toBeLessThanOrEqual(301);
      expect(message.endsWith("…")).toBe(true);
      expect(formatNonPassingTests(collectNonPassingTests(report))).not.toContain("stack line");
    });

    it("exposes them through evaluateE2eReport without changing the error list", () => {
      const result = evaluateE2eReport(report, 300_000);
      expect(result.nonPassing).toHaveLength(2);
      expect(result.errors).toEqual([
        "1 test(s) passed only after a retry and are classified as flaky.",
        "1 test(s) have an unexpected final result.",
      ]);
    });

    it("keeps the names when shard reports are aggregated", () => {
      const aggregated = aggregateE2eReports([
        report,
        { stats: { duration: 2, expected: 1, skipped: 0, unexpected: 0, flaky: 0 } },
      ]);
      expect(collectNonPassingTests(aggregated)).toHaveLength(2);
    });

    it("tolerates reports with no suites tree", () => {
      expect(collectNonPassingTests({ stats: { duration: 1 } })).toEqual([]);
    });
  });
});
