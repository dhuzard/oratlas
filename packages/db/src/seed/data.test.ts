import { describe, expect, it } from "vitest";
import { knowledgeNodeSchema, nodeEdgeSchema } from "@oratlas/contracts";
import { pendingSubmission, seedKnowledgeNodes, seedNodeEdges, seedReviews } from "./data.js";

describe("seed snapshot identities", () => {
  it("uses full hexadecimal Git object ids", () => {
    const objectIds = [
      ...seedReviews.map((review) => review.snapshot.commitSha),
      pendingSubmission.snapshot.commitSha,
    ];
    for (const objectId of objectIds) {
      expect(objectId).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    }
  });
});

describe("seed knowledge graph", () => {
  it("covers two laboratories and every node kind with valid contracts", () => {
    expect(new Set(seedKnowledgeNodes.map((fixture) => fixture.repositoryKey)).size).toBe(2);
    expect(seedKnowledgeNodes.length).toBeGreaterThanOrEqual(6);
    expect(new Set(seedKnowledgeNodes.map((fixture) => fixture.node.kind))).toEqual(
      new Set(["claim", "figure", "dataset", "code"]),
    );
    for (const fixture of seedKnowledgeNodes) {
      expect(knowledgeNodeSchema.safeParse(fixture.node).success).toBe(true);
    }
  });

  it("has resolvable typed edges including cross-lab contradiction and replication", () => {
    const identities = new Set(
      seedKnowledgeNodes.map((fixture) => `${fixture.repositoryKey}:${fixture.node.id}`),
    );
    for (const fixture of seedNodeEdges) {
      expect(nodeEdgeSchema.safeParse(fixture.edge).success).toBe(true);
      expect(identities.has(`${fixture.sourceRepositoryKey}:${fixture.edge.sourceNodeId}`)).toBe(
        true,
      );
      expect(identities.has(`${fixture.targetRepositoryKey}:${fixture.edge.targetNodeId}`)).toBe(
        true,
      );
    }
    for (const relationType of ["contradicts", "replicates"] as const) {
      expect(
        seedNodeEdges.some(
          (fixture) =>
            fixture.edge.relationType === relationType &&
            fixture.sourceRepositoryKey !== fixture.targetRepositoryKey,
        ),
      ).toBe(true);
    }
  });

  it("contains one explicitly flagged example-DOI node with distinct DOI roles", () => {
    const doiNodes = seedKnowledgeNodes.filter(
      (fixture) => fixture.node.versionDoi || fixture.node.conceptDoi,
    );
    expect(doiNodes).toHaveLength(1);
    expect(doiNodes[0]?.isExample).toBe(true);
    expect(doiNodes[0]?.node.versionDoi).toMatch(/^10\.5555\//);
    expect(doiNodes[0]?.node.conceptDoi).toMatch(/^10\.5555\//);
    expect(doiNodes[0]?.node.versionDoi).not.toBe(doiNodes[0]?.node.conceptDoi);
  });
});
