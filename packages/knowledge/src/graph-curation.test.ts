import { describe, expect, it } from "vitest";
import { curateGraphRelation, prepareGraphCurationPacket } from "./graph-curation.js";
import type { LlmProvider } from "./discuss.js";

const commitSha = "a".repeat(40);

function packet() {
  return prepareGraphCurationPacket({
    source: {
      nodeId: "source-node",
      versionId: "source-version",
      kind: "claim",
      repository: "https://github.com/example/source",
      commitSha,
      title: "Source claim",
      abstract: "Treatment reduced the measured outcome in the registered experiment.",
      text: "The effect was observed in two independent cohorts.",
      payload: { claimType: "empirical" },
    },
    target: {
      nodeId: "target-node",
      versionId: "target-version",
      kind: "claim",
      repository: "https://github.com/example/target",
      commitSha,
      title: "Target claim",
      abstract: "A larger replication found no measurable treatment effect.",
      text: "The confidence interval excluded the originally reported magnitude.",
      payload: { claimType: "empirical" },
    },
  });
}

function provider(outputs: string[]): LlmProvider {
  let index = 0;
  return {
    name: "test",
    model: "offline",
    async complete() {
      return outputs[Math.min(index++, outputs.length - 1)]!;
    },
  };
}

describe("graph curation", () => {
  it("retries a fabricated quote and accepts a fully grounded proposal", async () => {
    const invalid = JSON.stringify({
      decision: "propose",
      relationType: "contradicts",
      rationale: "The exact versions report opposing conclusions about the treatment effect.",
      evidence: {
        sourceQuotes: ["This quote was fabricated and is not in the packet."],
        targetQuotes: ["A larger replication found no measurable treatment effect."],
        comparison: "The source reports a reduction while the target reports no measurable effect.",
        limitations: ["Only the supplied node versions were compared."],
      },
    });
    const valid = JSON.stringify({
      decision: "propose",
      relationType: "contradicts",
      rationale: "The exact versions report opposing conclusions about the treatment effect.",
      evidence: {
        sourceQuotes: ["Treatment reduced the measured outcome in the registered experiment."],
        targetQuotes: ["A larger replication found no measurable treatment effect."],
        comparison: "The source reports a reduction while the target reports no measurable effect.",
        limitations: ["Only the supplied node versions were compared."],
      },
    });
    const result = await curateGraphRelation(provider([invalid, valid]), packet());
    expect(result.attempts).toBe(2);
    expect(result.decision).toMatchObject({
      decision: "propose",
      relationType: "contradicts",
    });
  });

  it("preserves a model abstention rather than forcing an edge", async () => {
    const result = await curateGraphRelation(
      provider([
        JSON.stringify({
          decision: "abstain",
          reason: "The supplied exact versions do not establish a direct semantic relationship.",
          missingEvidence: ["A shared outcome definition"],
        }),
      ]),
      packet(),
    );
    expect(result.decision).toEqual({
      decision: "abstain",
      reason: "The supplied exact versions do not establish a direct semantic relationship.",
      missingEvidence: ["A shared outcome definition"],
    });
  });
});
