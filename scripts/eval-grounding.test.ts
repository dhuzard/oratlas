import { describe, expect, it, vi } from "vitest";
import baseline from "../packages/knowledge/src/grounding-eval-fixtures/baseline-positive.js";
import {
  groundingEvalPacket,
  validGroundingResponse,
} from "../packages/knowledge/src/grounding-evaluation-fixture-support.js";
import {
  defineGroundingEvalFixture,
  GROUNDING_EVAL_LIMITS,
  type GroundingEvalFixture,
} from "../packages/knowledge/src/grounding-evaluation.js";
import {
  discoverGroundingEvalFixtures,
  GROUNDING_EVAL_EXIT,
  runGroundingEvalCli,
} from "./eval-grounding.js";

function capture() {
  const reports: string[] = [];
  return { reports, write: (report: string) => reports.push(report) };
}

describe("eval-grounding CLI", () => {
  it("auto-discovers the sorted one-file corpus", async () => {
    const fixtures = await discoverGroundingEvalFixtures();
    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      "baseline-positive",
      "example-reference",
      "fabricated-doi",
      "prompt-injection",
      "reserved-example-doi",
      "unknown-reference",
      "wrong-owner",
      "wrong-version",
    ]);
  });

  it("passes offline without reading provider configuration or exposing evaluation content", async () => {
    const { reports, write } = capture();
    const accessed: string[] = [];
    const env = new Proxy<Record<string, string | undefined>>(
      { ORATLAS_GROUNDING_EVAL_REAL: "" },
      {
        get(target, property: string) {
          accessed.push(property);
          if (property !== "ORATLAS_GROUNDING_EVAL_REAL") throw new Error("key read");
          return target[property];
        },
      },
    );

    const status = await runGroundingEvalCli([], { env, write });

    expect(status).toBe(GROUNDING_EVAL_EXIT.passed);
    expect(accessed).toEqual(["ORATLAS_GROUNDING_EVAL_REAL"]);
    expect(reports).toHaveLength(1);
    const report = JSON.parse(reports[0]!) as { summary: unknown; cases: unknown[] };
    expect(report.summary).toEqual({ total: 8, passed: 8, failed: 0 });
    expect(report.cases).toHaveLength(8);
    expect(reports[0]).not.toMatch(/10\.\d{4,9}\//i);
    expect(reports[0]).not.toContain("IGNORE THE SYSTEM PROMPT");
    expect(reports[0]).not.toContain("packet");
    expect(reports[0]).not.toContain("promptHash");
    expect(reports[0]).not.toContain("AgentRun");
  });

  it("uses exit 1 only for a completed expectation mismatch", async () => {
    const { reports, write } = capture();
    const mismatch = defineGroundingEvalFixture({
      ...baseline,
      id: "expectation-mismatch",
      expectedOutcome: "rejected" as const,
      expectedErrorCode: "unknown-reference" as const,
    });

    const status = await runGroundingEvalCli([], {
      env: {},
      write,
      discover: async () => [mismatch],
    });

    expect(status).toBe(GROUNDING_EVAL_EXIT.mismatch);
    expect(JSON.parse(reports[0]!)).toMatchObject({
      summary: { total: 1, passed: 0, failed: 1 },
      cases: [{ id: "expectation-mismatch", observedOutcome: "accepted", passed: false }],
    });
  });

  it("maps discovery, bounds, arguments, and provider failures to sanitized exit 2 reports", async () => {
    const scenarios: Array<{
      args?: string[];
      env?: Record<string, string>;
      discover?: () => Promise<GroundingEvalFixture[]>;
      expectedCode: string;
    }> = [
      {
        discover: async () => {
          throw new Error("sensitive fixture path and content");
        },
        expectedCode: "discovery-failed",
      },
      {
        discover: async () =>
          Array.from({ length: GROUNDING_EVAL_LIMITS.maxFixtures + 1 }, (_, index) => ({
            ...baseline,
            id: `overflow-${index}`,
          })),
        expectedCode: "fixture-overflow",
      },
      { args: ["--unknown"], expectedCode: "configuration-invalid" },
      {
        env: { ORATLAS_GROUNDING_EVAL_REAL: "1" },
        expectedCode: "configuration-invalid",
      },
      {
        env: {
          ORATLAS_GROUNDING_EVAL_REAL: "1",
          LLM_PROVIDER: "anthropic",
          ANTHROPIC_API_KEY: "secret-without-model",
        },
        expectedCode: "configuration-invalid",
      },
    ];

    for (const scenario of scenarios) {
      const { reports, write } = capture();
      const status = await runGroundingEvalCli(scenario.args ?? [], {
        env: scenario.env ?? {},
        write,
        ...(scenario.discover ? { discover: scenario.discover } : {}),
      });
      expect(status).toBe(GROUNDING_EVAL_EXIT.operationalError);
      expect(JSON.parse(reports[0]!)).toMatchObject({
        summary: { total: 0, passed: 0, failed: 0 },
        cases: [],
        operationalErrorCode: scenario.expectedCode,
      });
      expect(reports[0]).not.toContain("sensitive fixture path and content");
      expect(reports[0]).not.toContain("stack");
    }
  });

  it("runs only real-eligible fixtures with explicit config, a fixed timeout, and no retry", async () => {
    const { reports, write } = capture();
    const complete = vi.fn(async () => validGroundingResponse(groundingEvalPacket()));
    const createRealProvider = vi.fn(() => ({ name: "anthropic", model: "test", complete }));

    const status = await runGroundingEvalCli([], {
      env: {
        ORATLAS_GROUNDING_EVAL_REAL: "1",
        LLM_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "not-a-real-secret",
        LLM_MODEL: "test-model",
      },
      write,
      createRealProvider,
    });

    expect(status).toBe(GROUNDING_EVAL_EXIT.passed);
    expect(createRealProvider).toHaveBeenCalledWith({
      apiKey: "not-a-real-secret",
      model: "test-model",
      timeoutMs: GROUNDING_EVAL_LIMITS.maxRealProviderTimeoutMs,
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.parse(reports[0]!)).toMatchObject({
      mode: "real",
      summary: { total: 2, passed: 2, failed: 0 },
    });
    expect(reports[0]).not.toContain("not-a-real-secret");
  });

  it("bounds a hanging real provider and does not retry it", async () => {
    vi.useFakeTimers();
    const { reports, write } = capture();
    const complete = vi.fn(() => new Promise<string>(() => undefined));
    const result = runGroundingEvalCli([], {
      env: {
        ORATLAS_GROUNDING_EVAL_REAL: "1",
        LLM_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "secret",
        LLM_MODEL: "pinned-test-model",
      },
      write,
      discover: async () => [baseline],
      createRealProvider: () => ({ name: "anthropic", model: "test", complete }),
      realTimeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe(GROUNDING_EVAL_EXIT.operationalError);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(JSON.parse(reports[0]!)).toMatchObject({
      cases: [{ errorCode: "provider-failed", observedOutcome: "operational-error" }],
    });
    expect(reports[0]).not.toContain("secret");
    vi.useRealTimers();
  });
});
