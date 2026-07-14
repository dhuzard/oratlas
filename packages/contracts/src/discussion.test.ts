import { describe, expect, it } from "vitest";
import {
  groundedAnswerSchema,
  validateGrounding,
  type EvidencePacket,
  type GroundedAnswer,
} from "./discussion.js";

const packet: EvidencePacket = {
  schemaVersion: "1.1.0",
  question: "What is known?",
  builtAt: new Date(0).toISOString(),
  reviews: [
    {
      reviewSlug: "example-review",
      reviewVersionId: "rv1",
      title: "Example",
      commitSha: "a".repeat(40),
    },
  ],
  claims: [
    {
      claimId: "claim-1",
      localClaimId: "claim-local-1",
      reviewSlug: "example-review",
      reviewTitle: "Example",
      reviewVersionId: "rv1",
      commitSha: "a".repeat(40),
      text: "Sleep improves memory consolidation.",
      anchor: "oratlas-claim-1",
      relations: [{ citationId: "cite-1", relationType: "supports" }],
    },
  ],
  citations: [
    {
      citationId: "cite-1",
      localCitationId: "cite-local-1",
      reviewVersionId: "rv1",
      workId: "doi:10.1000/example",
      canonicalWorkAliases: ["doi:10.1000/example"],
      title: "A study",
    },
  ],
  identifierConflicts: [],
};

const answer: GroundedAnswer = {
  answer: "Grounded answer.",
  scope: "One review.",
  reviewClaimsUsed: ["claim-1"],
  citationsUsed: ["cite-1"],
  agreements: [],
  disagreements: [],
  uncertainties: [],
  missingEvidence: [],
  grounding: [{ statement: "s", evidenceEdges: [{ claimId: "claim-1", citationId: "cite-1" }] }],
};

describe("validateGrounding", () => {
  it("accepts answers that only reference packet identifiers", () => {
    expect(validateGrounding(answer, packet).ok).toBe(true);
  });

  it("rejects unknown claim identifiers", () => {
    const bad = { ...answer, reviewClaimsUsed: ["claim-1", "fabricated-claim"] };
    const result = validateGrounding(bad, packet);
    expect(result.ok).toBe(false);
    expect(result.unknownClaimIds).toEqual(["fabricated-claim"]);
  });

  it("rejects unknown citation identifiers inside grounding entries", () => {
    const bad = {
      ...answer,
      grounding: [
        {
          statement: "s",
          evidenceEdges: [{ claimId: "claim-1", citationId: "fabricated-cite" }],
        },
      ],
    };
    const result = validateGrounding(bad, packet);
    expect(result.ok).toBe(false);
    expect(result.unknownCitationIds).toEqual(["fabricated-cite"]);
  });

  it("rejects a real citation attached to the wrong claim", () => {
    const secondClaim = {
      ...packet.claims[0]!,
      claimId: "claim-2",
      localClaimId: "claim-local-2",
      anchor: "oratlas-claim-2",
      relations: [],
    };
    const expandedPacket = { ...packet, claims: [...packet.claims, secondClaim] };
    const bad = {
      ...answer,
      reviewClaimsUsed: ["claim-2"],
      grounding: [
        {
          statement: "citation laundering",
          evidenceEdges: [{ claimId: "claim-2", citationId: "cite-1" }],
        },
      ],
    };
    const result = validateGrounding(bad, expandedPacket);
    expect(result.ok).toBe(false);
    expect(result.invalidEvidenceEdges).toEqual([{ claimId: "claim-2", citationId: "cite-1" }]);
  });

  it("requires exact agreement between summary ids and statement edges", () => {
    const omittedEdge = { ...answer, grounding: [] };
    const result = validateGrounding(omittedEdge, packet);
    expect(result.ok).toBe(false);
    expect(result.claimsMissingFromGrounding).toEqual(["claim-1"]);
    expect(result.citationsMissingFromGrounding).toEqual(["cite-1"]);
  });

  it("fails the answer schema closed when no statement has an evidence edge", () => {
    expect(groundedAnswerSchema.safeParse({ ...answer, grounding: [] }).success).toBe(false);
  });
});
