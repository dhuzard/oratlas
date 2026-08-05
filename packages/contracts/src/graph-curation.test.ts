import { describe, expect, it } from "vitest";
import { validateGraphCurationOutput, type GraphCurationPacket } from "./graph-curation.js";

const packet: GraphCurationPacket = {
  schemaVersion: "1.0.0",
  question: "Which graph relations are missing?",
  nodes: [
    { landscapeNodeId: "claim:a", nodeId: "a", nodeVersionId: "av1", kind: "claim", title: "A" },
    { landscapeNodeId: "graph:b", nodeId: "b", nodeVersionId: "bv1", kind: "dataset", title: "B" },
  ],
  confirmedEdges: [],
};

describe("graph curation contract", () => {
  it("accepts only exact packet identifiers", () => {
    expect(
      validateGraphCurationOutput(
        {
          schemaVersion: "1.0.0",
          proposals: [
            {
              sourceNodeVersionId: "av1",
              targetNodeVersionId: "bv1",
              relationType: "uses-dataset",
              rationale: "The claim explicitly relies on the preserved dataset node.",
              evidenceNodeIds: ["claim:a", "graph:b"],
            },
          ],
        },
        packet,
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["unknown source", { sourceNodeVersionId: "invented" }],
    ["unknown target", { targetNodeVersionId: "invented" }],
    ["unknown evidence", { evidenceNodeIds: ["invented"] }],
    ["self edge", { targetNodeVersionId: "av1" }],
  ])("rejects %s", (_label, override) => {
    const candidate = {
      sourceNodeVersionId: "av1",
      targetNodeVersionId: "bv1",
      relationType: "uses-dataset",
      rationale: "The claim explicitly relies on the preserved dataset node.",
      evidenceNodeIds: ["claim:a"],
      ...override,
    };
    expect(
      validateGraphCurationOutput({ schemaVersion: "1.0.0", proposals: [candidate] }, packet).ok,
    ).toBe(false);
  });

  it("rejects confirmed and duplicate proposals", () => {
    const candidate = {
      sourceNodeVersionId: "av1",
      targetNodeVersionId: "bv1",
      relationType: "uses-dataset" as const,
      rationale: "The claim explicitly relies on the preserved dataset node.",
      evidenceNodeIds: ["claim:a"],
    };
    expect(
      validateGraphCurationOutput(
        { schemaVersion: "1.0.0", proposals: [candidate] },
        {
          ...packet,
          confirmedEdges: [
            {
              sourceNodeVersionId: candidate.sourceNodeVersionId,
              targetNodeVersionId: candidate.targetNodeVersionId,
              relationType: candidate.relationType,
            },
          ],
        },
      ).ok,
    ).toBe(false);
    expect(
      validateGraphCurationOutput(
        { schemaVersion: "1.0.0", proposals: [candidate, candidate] },
        packet,
      ).ok,
    ).toBe(false);
  });
});
