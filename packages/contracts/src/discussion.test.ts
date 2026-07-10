import { describe, expect, it } from "vitest";
import { validateGrounding, type EvidencePacket, type GroundedAnswer } from "./discussion.js";

const packet: EvidencePacket = {
  schemaVersion: "1.0.0",
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
      reviewSlug: "example-review",
      reviewTitle: "Example",
      reviewVersionId: "rv1",
      text: "Sleep improves memory consolidation.",
      relations: [],
    },
  ],
  citations: [{ citationId: "cite-1", title: "A study" }],
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
  grounding: [{ statement: "s", claimIds: ["claim-1"], citationIds: ["cite-1"] }],
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
      grounding: [{ statement: "s", claimIds: ["claim-1"], citationIds: ["fabricated-cite"] }],
    };
    const result = validateGrounding(bad, packet);
    expect(result.ok).toBe(false);
    expect(result.unknownCitationIds).toEqual(["fabricated-cite"]);
  });
});
