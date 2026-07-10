import { describe, expect, it } from "vitest";
import { InProcessSearchProvider } from "./search.js";
import { buildEvidencePacket, hashEvidencePacket } from "./packet.js";
import { discussDeterministic, discussWithLlm, type LlmProvider } from "./discuss.js";
import { proposeCrossReviewLinks } from "./links.js";
import { extractJsonObject } from "./providers/anthropic.js";
import { sampleIndex } from "./fixtures.js";
import { type EvidencePacket, type GroundedAnswer } from "@oratlas/contracts";

const now = () => new Date("2026-07-01T00:00:00Z");

describe("InProcessSearchProvider", () => {
  const provider = new InProcessSearchProvider(sampleIndex);

  it("finds reviews by lexical relevance", () => {
    const result = provider.searchReviews({
      q: "replay memory",
      sort: "relevance",
      page: 1,
      pageSize: 20,
    });
    expect(result.items[0]?.reviewSlug).toBe("replay-review");
  });

  it("filters by DOI availability", () => {
    const withDoi = provider.searchReviews({
      hasDoi: true,
      sort: "accepted",
      page: 1,
      pageSize: 20,
    });
    expect(withDoi.items.map((r) => r.reviewSlug)).toEqual(["replay-review"]);
    const withoutDoi = provider.searchReviews({
      hasDoi: false,
      sort: "accepted",
      page: 1,
      pageSize: 20,
    });
    expect(withoutDoi.items.map((r) => r.reviewSlug)).toEqual(["attention-review"]);
  });

  it("filters by human-reviewed TRUST state", () => {
    const humanReviewed = provider.searchReviews({
      trustReviewState: "human-reviewed",
      sort: "accepted",
      page: 1,
      pageSize: 20,
    });
    expect(humanReviewed.items.map((r) => r.reviewSlug)).toEqual(["replay-review"]);
  });

  it("searches claims and filters by relation type", () => {
    const contradicting = provider.searchClaims({
      relationType: "contradicts",
      sort: "relevance",
      page: 1,
      pageSize: 20,
    } as never);
    expect(contradicting.items.map((c) => c.claimId)).toEqual(["c-replay-2"]);
  });
});

describe("buildEvidencePacket", () => {
  it("builds a packet with claims, relations, TRUST status and citations", () => {
    const packet = buildEvidencePacket(sampleIndex, "memory consolidation", { now });
    expect(packet.claims.length).toBeGreaterThan(0);
    const ids = packet.claims.map((c) => c.claimId);
    expect(ids).toContain("c-replay-1");
    // Only cited citations are included.
    expect(packet.citations.map((c) => c.citationId)).toContain("ref-shared");
    // TRUST review status is carried.
    const c1 = packet.claims.find((c) => c.claimId === "c-replay-1");
    expect(c1?.relations[0]?.trust?.reviewStatus).toBe("human-reviewed");
  });

  it("produces a stable hash independent of claim ordering", () => {
    const p1 = buildEvidencePacket(sampleIndex, "memory", { now });
    const p2 = buildEvidencePacket(sampleIndex, "memory", { now });
    expect(hashEvidencePacket(p1)).toBe(hashEvidencePacket(p2));
  });
});

describe("discussDeterministic", () => {
  it("groups matched claims by relation and never fabricates prose", () => {
    const packet = buildEvidencePacket(sampleIndex, "memory consolidation replay", { now });
    const result = discussDeterministic(packet);
    expect(result.mode).toBe("deterministic");
    expect(result.matchedClaimCount).toBeGreaterThan(0);
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.notes.join(" ")).toContain("not independent replication");
  });

  it("flags insufficient evidence for an unrelated question", () => {
    const packet = buildEvidencePacket(sampleIndex, "quantum chromodynamics lattice gauge", {
      now,
    });
    const result = discussDeterministic(packet);
    expect(result.insufficientEvidence).toBe(true);
  });
});

function fakeProvider(output: (packet: EvidencePacket) => string): LlmProvider {
  return {
    name: "fake",
    model: "fake-model",
    modelVersion: "1",
    promptVersion: "test-1.0",
    async complete(packet) {
      return output(packet);
    },
  };
}

describe("discussWithLlm — grounding enforcement", () => {
  it("accepts a well-grounded answer", async () => {
    const packet = buildEvidencePacket(sampleIndex, "memory consolidation", { now });
    const claimId = packet.claims[0]!.claimId;
    const citationId = packet.citations[0]!.citationId;
    const answer: GroundedAnswer = {
      answer: "Grounded.",
      scope: "One review.",
      reviewClaimsUsed: [claimId],
      citationsUsed: [citationId],
      agreements: [],
      disagreements: [],
      uncertainties: [],
      missingEvidence: [],
      grounding: [{ statement: "s", claimIds: [claimId], citationIds: [citationId] }],
    };
    const result = await discussWithLlm(
      fakeProvider(() => JSON.stringify(answer)),
      packet,
    );
    expect(result.answer).toBeDefined();
    expect(result.grounding?.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("rejects and retries an answer citing an unknown claim id", async () => {
    const packet = buildEvidencePacket(sampleIndex, "memory consolidation", { now });
    const bad: GroundedAnswer = {
      answer: "Hallucinated.",
      scope: "x",
      reviewClaimsUsed: ["fabricated-claim-999"],
      citationsUsed: [],
      agreements: [],
      disagreements: [],
      uncertainties: [],
      missingEvidence: [],
      grounding: [{ statement: "s", claimIds: ["fabricated-claim-999"], citationIds: [] }],
    };
    const result = await discussWithLlm(
      fakeProvider(() => JSON.stringify(bad)),
      packet,
      2,
    );
    expect(result.answer).toBeUndefined();
    expect(result.error).toContain("unknown identifiers");
    expect(result.attempts).toBe(2);
  });

  it("rejects non-JSON output", async () => {
    const packet = buildEvidencePacket(sampleIndex, "memory", { now });
    const result = await discussWithLlm(
      fakeProvider(() => "I cannot answer that."),
      packet,
      1,
    );
    expect(result.answer).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
});

describe("proposeCrossReviewLinks", () => {
  it("proposes a shared-citation link across reviews and never within one", () => {
    const proposals = proposeCrossReviewLinks(sampleIndex.claims);
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.sourceReviewSlug).not.toBe(p.targetReviewSlug);
    }
    const shared = proposals.find((p) => p.proposedRelation === "shared-citations");
    expect(shared).toBeDefined();
    expect(shared?.features.sharedCitations).toContain("ref-shared");
  });
});

describe("extractJsonObject", () => {
  it("extracts JSON from fenced or prose-wrapped model output", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('Sure: {"a":1} done')).toBe('{"a":1}');
  });
});
