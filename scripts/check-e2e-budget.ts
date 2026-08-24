import { readFile } from "node:fs/promises";

// The four serial shards cover 83 browser journeys, including full accessibility,
// publication, staleness, and responsive-layout paths. Keep a bounded 8.5-minute
// ceiling while still rejecting every retry and unexpected final result.
export const E2E_WALL_TIME_BUDGET_MS = 8.5 * 60 * 1_000;

interface PlaywrightJsonReport {
  stats?: {
    duration?: number;
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
  };
}

export function aggregateE2eReports(reports: PlaywrightJsonReport[]): PlaywrightJsonReport {
  if (reports.length === 0) {
    throw new Error("At least one Playwright JSON report is required.");
  }

  return {
    stats: reports.reduce(
      (total, report) => {
        const stats = report.stats;
        if (
          typeof stats?.duration !== "number" ||
          !Number.isFinite(stats.duration) ||
          stats.duration < 0
        ) {
          throw new Error("A Playwright JSON report does not contain valid duration statistics.");
        }
        return {
          duration: total.duration + stats.duration,
          expected: total.expected + count(stats.expected),
          skipped: total.skipped + count(stats.skipped),
          unexpected: total.unexpected + count(stats.unexpected),
          flaky: total.flaky + count(stats.flaky),
        };
      },
      { duration: 0, expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
    ),
  };
}

export interface E2eBudgetResult {
  durationMs: number;
  budgetMs: number;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
  errors: string[];
}

export function evaluateE2eReport(
  report: PlaywrightJsonReport,
  budgetMs = E2E_WALL_TIME_BUDGET_MS,
): E2eBudgetResult {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error("The E2E wall-time budget must be a positive number.");
  }
  const stats = report.stats;
  const durationMs = stats?.duration;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("The Playwright JSON report does not contain valid duration statistics.");
  }

  const unexpected = count(stats?.unexpected);
  const flaky = count(stats?.flaky);
  const errors: string[] = [];
  if (durationMs > budgetMs) {
    errors.push(`E2E wall time ${durationMs}ms exceeds the ${budgetMs}ms budget.`);
  }
  if (flaky > 0) {
    errors.push(`${flaky} test(s) passed only after a retry and are classified as flaky.`);
  }
  if (unexpected > 0) {
    errors.push(`${unexpected} test(s) have an unexpected final result.`);
  }

  return {
    durationMs,
    budgetMs,
    expected: count(stats?.expected),
    skipped: count(stats?.skipped),
    unexpected,
    flaky,
    errors,
  };
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

async function main(): Promise<void> {
  const reportPaths = process.argv.slice(2);
  if (reportPaths.length === 0) reportPaths.push("apps/web/test-results/e2e-results.json");
  const reports = await Promise.all(
    reportPaths.map(
      async (reportPath) => JSON.parse(await readFile(reportPath, "utf8")) as PlaywrightJsonReport,
    ),
  );
  const report = aggregateE2eReports(reports);
  const result = evaluateE2eReport(report);
  console.log(
    `E2E timing: ${result.durationMs}ms / ${result.budgetMs}ms; ` +
      `${result.expected} expected, ${result.skipped} skipped, ${result.flaky} flaky, ` +
      `${result.unexpected} unexpected.`,
  );
  if (result.errors.length > 0) throw new Error(result.errors.join("\n"));
}

if (process.argv[1]?.endsWith("check-e2e-budget.ts")) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
