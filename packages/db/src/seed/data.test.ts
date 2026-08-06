import { describe, expect, it } from "vitest";
import { knowledgeNodeSchema, nodeEdgeSchema } from "@oratlas/contracts";
import {
  openscopeP3DataRelease,
  pendingSubmission,
  seedKnowledgeNodes,
  seedNodeEdges,
  seedReviews,
  templateDemoReview,
  vipComputationalReview,
} from "./data.js";

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

  it("pins the requested public repositories and keeps their POC roles explicit", () => {
    expect(seedReviews.map((review) => review.repository.canonicalUrl)).toEqual(
      expect.arrayContaining([
        "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate",
        "https://github.com/AllenNeuralDynamics/ComputationalReviewVIP",
        "https://github.com/jeromelecoq/openscope_p3_data_release_paper",
      ]),
    );
    expect(templateDemoReview).toMatchObject({
      claims: [],
      pocEvaluation: { corpusRole: "structural-control" },
    });
    expect(vipComputationalReview.pocEvaluation).toMatchObject({ corpusRole: "ai-review" });
    expect(openscopeP3DataRelease.pocEvaluation).toMatchObject({ corpusRole: "data-release" });
    for (const review of [templateDemoReview, vipComputationalReview, openscopeP3DataRelease]) {
      expect(review.repository.githubRepositoryId).toMatch(/^\d+$/);
      expect(review.snapshot.treeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(review.snapshot.preserveSyntheticArticle).toBe(false);
      expect(review.version.isExample).toBe(true);
      expect(review.pocEvaluation?.limitations.length).toBeGreaterThan(0);
      expect(review.pocEvaluation?.suggestedFixes.length).toBeGreaterThan(0);
    }
  });

  it("keeps findings distinct from capabilities in the source-derived corpus", () => {
    expect(vipComputationalReview.claims).toHaveLength(4);
    expect(vipComputationalReview.relations).toHaveLength(6);
    expect(vipComputationalReview.citations.every((citation) => !citation.isExample)).toBe(true);

    const capability = openscopeP3DataRelease.claims.find(
      (claim) => claim.localId === "alternative-hypotheses",
    );
    expect(capability).toMatchObject({ claimType: "hypothesis-capability" });
    expect(capability?.qualification).toMatch(/not evidence/i);
    expect(
      openscopeP3DataRelease.claims.some((claim) => claim.claimType === "provenance-limitation"),
    ).toBe(true);
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
    const dataset = doiNodes[0]?.node;
    if (!dataset || dataset.kind !== "dataset")
      throw new Error("Expected the DOI dataset fixture.");
    expect(new Set([dataset.versionDoi, dataset.conceptDoi, dataset.payload.doi]).size).toBe(3);
  });
});
