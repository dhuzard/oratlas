import { describe, expect, it } from "vitest";
import type { KnowledgeIndexData } from "@oratlas/knowledge";
import { buildReviewComparison } from "./review-comparison";

const index: KnowledgeIndexData = {
  reviews: [
    {
      reviewSlug: "review-a",
      reviewId: "r1",
      reviewVersionId: "v1",
      title: "Review A",
      keywords: [],
      domains: [],
      authors: [],
      commitSha: "a".repeat(40),
      hasDoi: false,
      hasTrustData: true,
      hasEvidenceData: true,
      hasHumanReviewedTrust: true,
      status: "published",
    },
  ],
  claims: [
    {
      claimId: "claim-a",
      localClaimId: "claim-001",
      reviewSlug: "review-a",
      reviewId: "r1",
      reviewVersionId: "v1",
      reviewTitle: "Review A",
      text: "A bounded claim.",
      claimType: "empirical",
      anchor: "claim-anchor",
      commitSha: "a".repeat(40),
      relations: [
        {
          citationId: "citation-a",
          relationType: "contradicts",
          trustAssessments: [
            {
              assessmentId: "trust-a",
              protocolVersion: "trust-1",
              assessorType: "human",
              reviewStatus: "human-reviewed",
              verificationState: "platform-verified",
              notableCriteria: ["entailment"],
            },
          ],
        },
      ],
    },
  ],
  citations: [
    {
      citationId: "citation-a",
      localCitationId: "cite-001",
      reviewVersionId: "v1",
      workId: "work-a",
      canonicalWorkAliases: [],
    },
  ],
  identifierConflicts: [],
};

describe("review comparison projection", () => {
  it("compares coverage without manufacturing an aggregate quality score", () => {
    const [column] = buildReviewComparison(index, ["review-a", "review-a", "missing"]);
    expect(column).toMatchObject({
      claimCount: 1,
      citationCount: 1,
      evidenceRelationCount: 1,
      contradictingRelationCount: 1,
      trustAssessmentCount: 1,
      humanReviewedTrustCount: 1,
      claimTypes: [{ type: "empirical", count: 1 }],
    });
    expect(column).not.toHaveProperty("score");
    expect(column?.claims[0]).toMatchObject({
      passportPath: "/claims/v1/claim-001",
      trustAssessmentCount: 1,
    });
  });
});
