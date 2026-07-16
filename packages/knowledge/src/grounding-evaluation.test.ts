import { describe, expect, it, vi } from "vitest";
import baseline from "./grounding-eval-fixtures/baseline-positive.js";
import fabricatedDoi from "./grounding-eval-fixtures/fabricated-doi.js";
import promptInjection from "./grounding-eval-fixtures/prompt-injection.js";
import unknownReference from "./grounding-eval-fixtures/unknown-reference.js";
import {
  GROUNDING_EVAL_INJECTION,
  groundingEvalPacket,
  validGroundingResponse,
} from "./grounding-evaluation-fixture-support.js";
import {
  defineGroundingEvalFixture,
  evaluateGroundingFixtures,
  GroundingEvalFixtureError,
  GROUNDING_EVAL_LIMITS,
  prepareGroundingEvalFixtures,
} from "./grounding-evaluation.js";
import { SYNTHESIS_SYSTEM_PROMPT } from "./synthesis-writer.js";
import type { LlmProvider } from "./discuss.js";

describe("grounding evaluation", () => {
  it("sorts fixtures and evaluates positive and adversarial outputs deterministically", async () => {
    const report = await evaluateGroundingFixtures([
      unknownReference,
      promptInjection,
      fabricatedDoi,
      baseline,
    ]);

    expect(report).toEqual({
      schemaVersion: "1.0.0",
      runnerVersion: "grounding-eval/1.0.0",
      mode: "mock",
      summary: { total: 4, passed: 4, failed: 0 },
      cases: [
        {
          id: "baseline-positive",
          passed: true,
          expectedOutcome: "accepted",
          observedOutcome: "accepted",
        },
        {
          id: "fabricated-doi",
          passed: true,
          expectedOutcome: "rejected",
          observedOutcome: "rejected",
          errorCode: "unstructured-identifier",
        },
        {
          id: "prompt-injection",
          passed: true,
          expectedOutcome: "accepted",
          observedOutcome: "accepted",
        },
        {
          id: "unknown-reference",
          passed: true,
          expectedOutcome: "rejected",
          observedOutcome: "rejected",
          errorCode: "unknown-reference",
        },
      ],
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(GROUNDING_EVAL_INJECTION);
    expect(serialized).not.toContain("10.1234");
    expect(serialized).not.toContain("packetHash");
    expect(serialized).not.toContain("system");
  });

  it("captures exactly one production request and leaves injection in canonical user data only", async () => {
    const requests: Parameters<LlmProvider["complete"]>[0][] = [];
    const provider: LlmProvider = {
      name: "test",
      model: "test-1",
      complete: vi.fn(async (request) => {
        requests.push(request);
        return validGroundingResponse(promptInjection.prepared);
      }),
    };

    const report = await evaluateGroundingFixtures([promptInjection], {
      mode: "real",
      provider,
    });

    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toBe(SYNTHESIS_SYSTEM_PROMPT);
    expect(requests[0]!.system).not.toContain(GROUNDING_EVAL_INJECTION);
    expect(requests[0]!.user).toContain(GROUNDING_EVAL_INJECTION);
    expect(requests[0]!.user).toBe(promptInjection.prepared.json);
  });

  it("validates all fixed bounds before any provider call", async () => {
    const provider: LlmProvider = {
      name: "unused",
      model: "unused",
      complete: vi.fn(async () => ""),
    };
    const fixtures = Array.from({ length: GROUNDING_EVAL_LIMITS.maxFixtures + 1 }, (_, index) =>
      defineGroundingEvalFixture({
        ...baseline,
        id: `bounded-${String(index).padStart(3, "0")}`,
      }),
    );

    await expect(
      evaluateGroundingFixtures(fixtures, { mode: "real", provider }),
    ).rejects.toMatchObject({ code: "fixture-overflow" });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(() =>
      prepareGroundingEvalFixtures([baseline, defineGroundingEvalFixture({ ...baseline })], "mock"),
    ).toThrow(GroundingEvalFixtureError);
  });

  it("reports request and fallback invariant failures without exception content", async () => {
    const prepared = groundingEvalPacket();
    const fixture = defineGroundingEvalFixture({
      id: "assertion-mismatch",
      prepared,
      expectedOutcome: "accepted",
      realEligible: false,
      mockResponse: validGroundingResponse,
      requestAssertions: { userIncludes: ["never present secret marker"] },
    });

    const report = await evaluateGroundingFixtures([fixture]);
    expect(report.cases).toEqual([
      {
        id: "assertion-mismatch",
        passed: false,
        expectedOutcome: "accepted",
        observedOutcome: "operational-error",
        errorCode: "request-invariant-failed",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret marker");
  });
});
