import { describe, expect, it } from "vitest";
import { proposeGraphCuration, type LlmProvider } from "./index.js";
import type { GraphCurationPacket } from "@oratlas/contracts";

const packet: GraphCurationPacket = {
  schemaVersion: "1.0.0",
  question: "Which relation is missing?",
  nodes: [
    { landscapeNodeId: "claim:a", nodeId: "a", nodeVersionId: "av1", kind: "claim", title: "A" },
    { landscapeNodeId: "graph:b", nodeId: "b", nodeVersionId: "bv1", kind: "code", title: "B" },
  ],
  confirmedEdges: [],
};

function provider(outputs: string[]): LlmProvider {
  return {
    name: "fake",
    model: "offline",
    async complete() {
      return outputs.shift() ?? "{}";
    },
  };
}

describe("proposeGraphCuration", () => {
  it("returns only validated private candidates", async () => {
    const result = await proposeGraphCuration(
      provider([
        JSON.stringify({
          schemaVersion: "1.0.0",
          proposals: [
            {
              sourceNodeVersionId: "av1",
              targetNodeVersionId: "bv1",
              relationType: "uses-code",
              rationale: "The claim explicitly relies on this preserved analysis code.",
              evidenceNodeIds: ["claim:a", "graph:b"],
            },
          ],
        }),
      ]),
      packet,
    );
    expect(result.output?.proposals).toHaveLength(1);
    expect(result.provider).toBe("fake");
  });

  it("rejects prose fences and invented identifiers without retaining raw output", async () => {
    const result = await proposeGraphCuration(
      provider([
        "```json\n{}\n```",
        JSON.stringify({
          schemaVersion: "1.0.0",
          proposals: [
            {
              sourceNodeVersionId: "invented",
              targetNodeVersionId: "bv1",
              relationType: "supports",
              rationale: "This deliberately references an identifier outside the packet.",
              evidenceNodeIds: ["claim:a"],
            },
          ],
        }),
      ]),
      packet,
    );
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/rejected|strict JSON/);
    expect(JSON.stringify(result)).not.toContain("```json");
  });
});
