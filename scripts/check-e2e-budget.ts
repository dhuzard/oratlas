import { appendFile, readFile } from "node:fs/promises";

// The six shards cover 83 browser journeys, including full accessibility,
// publication, staleness, and responsive-layout paths. The ceiling bounds the
// SUM of every shard's Playwright duration (total test work, not elapsed time,
// since shards run as parallel CI jobs). Keep a bounded 9.75-minute ceiling
// while still rejecting every retry and unexpected final result.
export const E2E_WALL_TIME_BUDGET_MS = 9.75 * 60 * 1_000;

interface PlaywrightJsonResult {
  status?: string;
  retry?: number;
  error?: { message?: string };
}

interface PlaywrightJsonTest {
  status?: string;
  results?: PlaywrightJsonResult[];
}

interface PlaywrightJsonSpec {
  title?: string;
  file?: string;
  line?: number;
  tests?: PlaywrightJsonTest[];
}

interface PlaywrightJsonSuite {
  title?: string;
  suites?: PlaywrightJsonSuite[];
  specs?: PlaywrightJsonSpec[];
}

export interface NonPassingTest {
  /** Playwright's own classification: `flaky` or `unexpected`. */
  status: "flaky" | "unexpected";
  file: string;
  line: number | null;
  title: string;
  /** First line of each failed attempt's error, truncated; never a stack. */
  failedAttempts: { retry: number; message: string }[];
}

interface PlaywrightJsonReport {
  suites?: PlaywrightJsonSuite[];
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
    suites: reports.flatMap((report) => report.suites ?? []),
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

const MAX_MESSAGE_CHARS = 300;

// eslint-disable-next-line no-control-regex -- strips ANSI colour codes from Playwright messages
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

function firstLine(message: string | undefined): string {
  const line = (message ?? "").replace(ANSI_ESCAPE, "").split("\n")[0]?.trim() ?? "";
  return line.length > MAX_MESSAGE_CHARS ? `${line.slice(0, MAX_MESSAGE_CHARS)}…` : line;
}

/**
 * Names every test that passed only after a retry (`flaky`) or ended in an
 * unexpected state, so a failing budget gate says which test to fix. Reads
 * Playwright's JSON `suites` tree; absent or malformed branches are ignored.
 */
export function collectNonPassingTests(report: PlaywrightJsonReport): NonPassingTest[] {
  const found: NonPassingTest[] = [];
  const walk = (suite: PlaywrightJsonSuite, titles: string[]): void => {
    const here = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "flaky" && test.status !== "unexpected") continue;
        found.push({
          status: test.status,
          file: spec.file ?? "unknown",
          line: typeof spec.line === "number" ? spec.line : null,
          title: [...here.slice(1), spec.title ?? "untitled"].join(" › "),
          failedAttempts: (test.results ?? [])
            .filter((result) => result.status !== "passed" && result.status !== "skipped")
            .map((result) => ({
              retry: typeof result.retry === "number" ? result.retry : 0,
              message: firstLine(result.error?.message),
            })),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return found.sort((a, b) =>
    `${a.file}:${a.line ?? 0}:${a.title}`.localeCompare(`${b.file}:${b.line ?? 0}:${b.title}`),
  );
}

export function formatNonPassingTests(tests: NonPassingTest[]): string {
  return tests
    .map((test) => {
      const where = test.line === null ? test.file : `${test.file}:${test.line}`;
      const attempts = test.failedAttempts
        .map((attempt) => `    attempt ${attempt.retry + 1}: ${attempt.message || "(no message)"}`)
        .join("\n");
      return `  [${test.status}] ${where} › ${test.title}${attempts ? `\n${attempts}` : ""}`;
    })
    .join("\n");
}

export interface E2eBudgetResult {
  durationMs: number;
  budgetMs: number;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
  nonPassing: NonPassingTest[];
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
    nonPassing: collectNonPassingTests(report),
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
  const summary =
    `E2E timing: ${result.durationMs}ms / ${result.budgetMs}ms; ` +
    `${result.expected} expected, ${result.skipped} skipped, ${result.flaky} flaky, ` +
    `${result.unexpected} unexpected.`;
  console.log(summary);
  if (result.nonPassing.length > 0) {
    console.log(`Non-passing tests:\n${formatNonPassingTests(result.nonPassing)}`);
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const detail =
      result.nonPassing.length > 0
        ? `\n\n\`\`\`text\n${formatNonPassingTests(result.nonPassing)}\n\`\`\``
        : "";
    await appendFile(summaryPath, `### E2E budget\n\n${summary}${detail}\n`);
  }
  if (result.errors.length > 0) throw new Error(result.errors.join("\n"));
}

if (process.argv[1]?.endsWith("check-e2e-budget.ts")) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
