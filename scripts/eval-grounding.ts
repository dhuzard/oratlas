import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson } from "../packages/contracts/src/index.js";
import {
  createAnthropicProvider,
  evaluateGroundingFixtures,
  GroundingEvalFixtureError,
  GROUNDING_EVAL_LIMITS,
  GROUNDING_EVAL_REPORT_VERSION,
  GROUNDING_EVAL_RUNNER_VERSION,
  type AnthropicProviderOptions,
  type GroundingEvalFixture,
  type GroundingEvalMode,
  type GroundingEvalReport,
  type LlmProvider,
} from "../packages/knowledge/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRECTORY = resolve(here, "../packages/knowledge/src/grounding-eval-fixtures");

export const GROUNDING_EVAL_EXIT = {
  passed: 0,
  mismatch: 1,
  operationalError: 2,
} as const;

export type GroundingEvalCliErrorCode =
  | "configuration-invalid"
  | "discovery-failed"
  | "fixture-invalid"
  | "fixture-overflow"
  | "runner-failed";

export interface GroundingEvalOperationalReport extends Omit<GroundingEvalReport, "cases"> {
  cases: [];
  operationalErrorCode: GroundingEvalCliErrorCode;
}

interface GroundingEvalEnvironment {
  readonly [name: string]: string | undefined;
}

export interface GroundingEvalCliDependencies {
  env?: GroundingEvalEnvironment;
  write?: (report: string) => void;
  discover?: () => Promise<GroundingEvalFixture[]>;
  createRealProvider?: (options: AnthropicProviderOptions) => LlmProvider;
  /** Test seam only; production always uses the fixed 30-second ceiling. */
  realTimeoutMs?: number;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isFixture(value: unknown): value is GroundingEvalFixture {
  if (!value || typeof value !== "object") return false;
  const fixture = value as Partial<GroundingEvalFixture>;
  return (
    typeof fixture.id === "string" &&
    typeof fixture.realEligible === "boolean" &&
    typeof fixture.mockResponse === "function"
  );
}

/** Discover typed, one-file fixtures from the repository-owned fixed directory. */
export async function discoverGroundingEvalFixtures(): Promise<GroundingEvalFixture[]> {
  const entries = await readdir(FIXTURE_DIRECTORY, { withFileTypes: true });
  const fixtureEntries = entries
    .filter((entry) => entry.name.endsWith(".ts"))
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  if (
    entries.length > GROUNDING_EVAL_LIMITS.maxFixtures ||
    fixtureEntries.length < 1 ||
    fixtureEntries.length > GROUNDING_EVAL_LIMITS.maxFixtures ||
    fixtureEntries.some((entry) => !entry.isFile() || !/^[a-z0-9][a-z0-9-]*\.ts$/.test(entry.name))
  ) {
    throw new GroundingEvalFixtureError(
      entries.length > GROUNDING_EVAL_LIMITS.maxFixtures ||
        fixtureEntries.length > GROUNDING_EVAL_LIMITS.maxFixtures
        ? "fixture-overflow"
        : "fixture-invalid",
    );
  }

  const fixtures: GroundingEvalFixture[] = [];
  for (const entry of fixtureEntries) {
    const fixturePath = join(FIXTURE_DIRECTORY, entry.name);
    const metadata = await stat(fixturePath);
    if (!metadata.isFile() || metadata.size > GROUNDING_EVAL_LIMITS.maxFixtureBytes) {
      throw new GroundingEvalFixtureError("fixture-overflow");
    }
    const module = (await import(pathToFileURL(fixturePath).href)) as {
      default?: unknown;
    };
    if (!isFixture(module.default)) throw new GroundingEvalFixtureError("fixture-invalid");
    fixtures.push(module.default);
  }
  return fixtures;
}

function operationalReport(
  mode: GroundingEvalMode,
  operationalErrorCode: GroundingEvalCliErrorCode,
): GroundingEvalOperationalReport {
  return {
    schemaVersion: GROUNDING_EVAL_REPORT_VERSION,
    runnerVersion: GROUNDING_EVAL_RUNNER_VERSION,
    mode,
    summary: { total: 0, passed: 0, failed: 0 },
    cases: [],
    operationalErrorCode,
  };
}

function boundedProvider(provider: LlmProvider, timeoutMs: number): LlmProvider {
  return {
    name: provider.name,
    model: provider.model,
    modelVersion: provider.modelVersion,
    complete(request) {
      return new Promise<string>((resolveCompletion, rejectCompletion) => {
        const timer = setTimeout(() => rejectCompletion(new Error("provider-timeout")), timeoutMs);
        void provider.complete(request).then(
          (response) => {
            clearTimeout(timer);
            resolveCompletion(response);
          },
          () => {
            clearTimeout(timer);
            rejectCompletion(new Error("provider-failed"));
          },
        );
      });
    },
  };
}

function writeReport(
  write: (report: string) => void,
  report: GroundingEvalReport | GroundingEvalOperationalReport,
): void {
  write(`${canonicalJson(report)}\n`);
}

export async function runGroundingEvalCli(
  args: readonly string[] = [],
  dependencies: GroundingEvalCliDependencies = {},
): Promise<number> {
  const env = dependencies.env ?? process.env;
  const write = dependencies.write ?? ((report: string) => process.stdout.write(report));
  const mode: GroundingEvalMode = env.ORATLAS_GROUNDING_EVAL_REAL === "1" ? "real" : "mock";

  if (args.length > 0) {
    writeReport(write, operationalReport(mode, "configuration-invalid"));
    return GROUNDING_EVAL_EXIT.operationalError;
  }

  let provider: LlmProvider | undefined;
  if (mode === "real") {
    const providerName = env.LLM_PROVIDER;
    const apiKey = env.ANTHROPIC_API_KEY;
    const model = env.LLM_MODEL;
    if (providerName !== "anthropic" || !apiKey || !model) {
      writeReport(write, operationalReport(mode, "configuration-invalid"));
      return GROUNDING_EVAL_EXIT.operationalError;
    }
    const timeoutMs = dependencies.realTimeoutMs ?? GROUNDING_EVAL_LIMITS.maxRealProviderTimeoutMs;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > GROUNDING_EVAL_LIMITS.maxRealProviderTimeoutMs
    ) {
      writeReport(write, operationalReport(mode, "configuration-invalid"));
      return GROUNDING_EVAL_EXIT.operationalError;
    }
    try {
      const createProvider = dependencies.createRealProvider ?? createAnthropicProvider;
      provider = boundedProvider(createProvider({ apiKey, model, timeoutMs }), timeoutMs);
    } catch {
      writeReport(write, operationalReport(mode, "configuration-invalid"));
      return GROUNDING_EVAL_EXIT.operationalError;
    }
  }

  let fixtures: GroundingEvalFixture[];
  try {
    fixtures = await (dependencies.discover ?? discoverGroundingEvalFixtures)();
  } catch (error) {
    const code = error instanceof GroundingEvalFixtureError ? error.code : "discovery-failed";
    writeReport(write, operationalReport(mode, code));
    return GROUNDING_EVAL_EXIT.operationalError;
  }

  try {
    const report = await evaluateGroundingFixtures(fixtures, {
      mode,
      ...(provider ? { provider } : {}),
    });
    writeReport(write, report);
    if (report.cases.some((result) => result.observedOutcome === "operational-error")) {
      return GROUNDING_EVAL_EXIT.operationalError;
    }
    return report.summary.failed === 0 ? GROUNDING_EVAL_EXIT.passed : GROUNDING_EVAL_EXIT.mismatch;
  } catch (error) {
    const code = error instanceof GroundingEvalFixtureError ? error.code : "runner-failed";
    writeReport(write, operationalReport(mode, code));
    return GROUNDING_EVAL_EXIT.operationalError;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void runGroundingEvalCli(process.argv.slice(2)).then((status) => {
    process.exitCode = status;
  });
}
