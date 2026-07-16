import { describe, expect, it } from "vitest";
import { InProcessSearchProvider } from "./search.js";
import { createHash } from "node:crypto";
import { buildEvidencePacket, hashEvidencePacket, prepareEvidencePacket } from "./packet.js";
import {
  buildDiscussionPrompt,
  discussDeterministic,
  discussWithLlm,
  extractJsonObject,
  type LlmProvider,
} from "./discuss.js";
import { proposeCrossReviewLinks } from "./links.js";
import { sampleIndex } from "./fixtures.js";
import { type GroundedAnswer } from "@oratlas/contracts";
import { tokenize } from "./text.js";

const now = () => new Date("2026-07-01T00:00:00Z");

describe("InProcessSearchProvider", () => {
  const provider = new InProcessSearchProvider(sampleIndex);

  it("searches public nodes by topic deterministically", () => {
    const nodes = [
      {
        nodeId: "n2",
        localNodeId: "data-attention",
        kind: "dataset",
        title: "Attention recordings",
        repositoryOwner: "lab",
        repositoryName: "atlas",
      },
      {
        nodeId: "n1",
        localNodeId: "claim-replay",
        kind: "claim",
        title: "Hippocampal replay",
        abstract: "Memory consolidation during sleep",
        repositoryOwner: "lab",
        repositoryName: "atlas",
      },
    ];
    const nodeProvider = new InProcessSearchProvider({ ...sampleIndex, nodes });
    expect(
      nodeProvider
        .searchNodes({ q: "memory replay", page: 1, pageSize: 10 })
        .items.map((n) => n.nodeId),
    ).toEqual(["n1"]);
    expect(
      nodeProvider.searchNodes({ q: "attention", kind: "claim", page: 1, pageSize: 10 }).items,
    ).toEqual([]);
  });

  it("finds reviews by lexical relevance", () => {
    const result = provider.searchReviews({
      q: "replay memory",
      sort: "relevance",
      page: 1,
      pageSize: 20,
    });
    expect(result.items[0]?.reviewSlug).toBe("replay-review");
  });

  it.each(["accepted", "updated", "title"] as const)(
    "excludes lexical nonmatches when sorted by %s",
    (sort) => {
      const result = provider.searchReviews({
        q: "quantum-chromodynamics-unrelated",
        sort,
        page: 1,
        pageSize: 20,
      });
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    },
  );

  it("distinguishes an absent query from a nonempty query containing no searchable terms", () => {
    const absent = provider.searchReviews({ sort: "accepted", page: 1, pageSize: 20 });
    const stopwords = provider.searchReviews({
      q: "the and of",
      sort: "accepted",
      page: 1,
      pageSize: 20,
    });
    const punctuation = provider.searchReviews({
      q: "... !!!",
      sort: "accepted",
      page: 1,
      pageSize: 20,
    });

    expect(absent.total).toBe(2);
    expect(stopwords.total).toBe(0);
    expect(punctuation.total).toBe(0);
  });

  it.each(["AI", "R", "MS", "AD", "UK", "3R"])(
    "searches the meaningful short scientific term %s without returning the whole archive",
    (term) => {
      const shortTermIndex = {
        ...sampleIndex,
        reviews: sampleIndex.reviews.map((review, index) =>
          index === 0 ? { ...review, keywords: [...review.keywords, term] } : review,
        ),
      };
      const shortTermProvider = new InProcessSearchProvider(shortTermIndex);
      const result = shortTermProvider.searchReviews({
        q: term,
        sort: "relevance",
        page: 1,
        pageSize: 20,
      });

      expect(result.items.map((review) => review.reviewSlug)).toEqual(["replay-review"]);
    },
  );

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
    expect(contradicting.items.map((c) => c.localClaimId)).toEqual(["c-replay-2"]);
  });
});

describe("tokenize", () => {
  it("normalizes accented Latin text and preserves non-Latin search terms", () => {
    expect(tokenize("Mémoire, réplication — Δίκτυο 神経科学")).toEqual([
      "memoire",
      "replication",
      "δίκτυο",
      "神経科学",
    ]);
  });

  it("preserves combining vowel signs and viramas in Indic scripts", () => {
    expect(tokenize("हिंदी தமிழ் తెలుగు")).toEqual(["हिंदी", "தமிழ்", "తెలుగు"]);
  });

  it("retains short scientific tokens while filtering ordinary stopwords", () => {
    expect(tokenize("AI R MS AD UK 3R in the study")).toEqual([
      "ai",
      "r",
      "ms",
      "ad",
      "uk",
      "3r",
      "study",
    ]);
  });
});

describe("buildEvidencePacket", () => {
  it("builds a packet with claims, relations, TRUST status and citations", () => {
    const packet = buildEvidencePacket(sampleIndex, "memory consolidation", { now });
    expect(packet.claims.length).toBeGreaterThan(0);
    expect(packet.schemaVersion).toBe("1.1.0");
    const ids = packet.claims.map((c) => c.localClaimId);
    expect(ids).toContain("c-replay-1");
    // Only cited citations are included.
    expect(packet.citations.map((c) => c.localCitationId)).toContain("ref-shared");
    // TRUST review status is carried.
    const c1 = packet.claims.find((c) => c.localClaimId === "c-replay-1");
    expect(c1?.relations[0]?.trust?.reviewStatus).toBe("human-reviewed");
    expect(c1?.relations[0]?.trust?.verificationState).toBe("platform-verified");
    expect(c1?.commitSha).toBe("a".repeat(40));
    expect(c1?.anchor).toMatch(/^oratlas-claim-v1-/);
    expect(c1?.sourceAnchor).toBe("sec-replay");
  });

  it("produces a stable hash independent of claim ordering", () => {
    const p1 = buildEvidencePacket(sampleIndex, "memory", { now });
    const p2 = buildEvidencePacket(sampleIndex, "memory", { now });
    expect(hashEvidencePacket(p1)).toBe(hashEvidencePacket(p2));
  });

  it("prepares one canonical byte string whose hash matches exactly", () => {
    const packet = buildEvidencePacket(sampleIndex, "memory", { now });
    const prepared = prepareEvidencePacket(packet);
    expect(prepared.json).toBe(prepareEvidencePacket(packet).json);
    expect(prepared.sha256).toBe(createHash("sha256").update(prepared.json, "utf8").digest("hex"));
    expect(hashEvidencePacket(prepared.json)).toBe(prepared.sha256);
  });
});

describe("buildDiscussionPrompt", () => {
  it("allows only hash-valid platform verification to be described as Atlas-reviewed", () => {
    const prompt = buildDiscussionPrompt("{}").system;
    expect(prompt).toContain("Only platform-verified may be described as Atlas-reviewed");
    expect(prompt).toContain("stale-verification");
    expect(prompt).toContain("legacy-unknown");
  });
});

describe("extractJsonObject", () => {
  it("preserves Atlas Discuss JSON/json fenced, plain, and prose compatibility", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('```JSON\r\n {"a":1} \r\n```')).toBe('{"a":1}');
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonObject('Sure: {"a":1} done')).toBe('{"a":1}');
  });

  it("handles large adversarial fences and whitespace with linear delimiter scans", () => {
    const whitespace = " \t\r\n".repeat(50_000);
    expect(extractJsonObject(`prefix\n\`\`\`JSON${whitespace}{"ok":true}\n\`\`\`suffix`)).toBe(
      '{"ok":true}',
    );
    expect(extractJsonObject(`\`\`\`json${whitespace}{"ok":true}`)).toBe('{"ok":true}');
    expect(extractJsonObject(`\`\`\`${"x".repeat(250_000)}\`\`\``)).toBe("x".repeat(250_000));
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

function fakeProvider(output: (packetJson: string) => string): LlmProvider {
  return {
    name: "fake",
    model: "fake-model",
    modelVersion: "1",
    async complete(request) {
      return output(request.user);
    },
  };
}

describe("discussWithLlm — grounding enforcement", () => {
  it("accepts a well-grounded answer", async () => {
    const packet = buildEvidencePacket(sampleIndex, "memory consolidation", { now });
    const claimId = packet.claims[0]!.claimId;
    const citationId = packet.claims[0]!.relations[0]!.citationId;
    const answer: GroundedAnswer = {
      answer: "Grounded.",
      scope: "One review.",
      reviewClaimsUsed: [claimId],
      citationsUsed: [citationId],
      agreements: [],
      disagreements: [],
      uncertainties: [],
      missingEvidence: [],
      grounding: [{ statement: "s", evidenceEdges: [{ claimId, citationId }] }],
    };
    let received = "";
    const prepared = prepareEvidencePacket(packet);
    const result = await discussWithLlm(
      fakeProvider((packetJson) => {
        received = packetJson;
        return JSON.stringify(answer);
      }),
      prepared,
    );
    expect(result.answer).toBeDefined();
    expect(result.grounding?.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(received).toBe(prepared.json);
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
      grounding: [
        {
          statement: "s",
          evidenceEdges: [
            {
              claimId: "fabricated-claim-999",
              citationId: packet.citations[0]!.citationId,
            },
          ],
        },
      ],
    };
    const result = await discussWithLlm(
      fakeProvider(() => JSON.stringify(bad)),
      prepareEvidencePacket(packet),
      2,
    );
    expect(result.answer).toBeUndefined();
    expect(result.error).toContain("claims=[fabricated-claim-999]");
    expect(result.attempts).toBe(2);
  });

  it("rejects non-JSON output", async () => {
    const packet = buildEvidencePacket(sampleIndex, "memory", { now });
    const result = await discussWithLlm(
      fakeProvider(() => "I cannot answer that."),
      prepareEvidencePacket(packet),
      1,
    );
    expect(result.answer).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
});

describe("proposeCrossReviewLinks", () => {
  it("proposes a shared-citation link across reviews and never within one", () => {
    const proposals = proposeCrossReviewLinks(sampleIndex.claims, sampleIndex.citations);
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.sourceReviewSlug).not.toBe(p.targetReviewSlug);
    }
    const shared = proposals.find((p) => p.proposedRelation === "shared-citations");
    expect(shared).toBeDefined();
    expect(shared?.features.sharedCitations).toContain("doi:10.5555/oratlas.example.shared");
  });

  it("does not match equal repository-local ids without a canonical work alias", () => {
    const withoutAliases = sampleIndex.citations.map((citation) => ({
      ...citation,
      canonicalWorkAliases: [],
      workId: citation.citationId,
    }));
    const proposals = proposeCrossReviewLinks(sampleIndex.claims, withoutAliases, {
      similarityThreshold: 1,
    });
    expect(proposals.some((proposal) => proposal.proposedRelation === "shared-citations")).toBe(
      false,
    );
  });

  it("does not merge a scholarly-work alias cluster with conflicting assertions", () => {
    const conflicted = sampleIndex.citations.map((citation) => {
      if (citation.reviewVersionId === "rv1" && citation.localCitationId === "ref-shared") {
        return {
          ...citation,
          canonicalWorkAliases: ["pmid:7", "doi:10.1000/a"] as typeof citation.canonicalWorkAliases,
        };
      }
      if (citation.reviewVersionId === "rv2" && citation.localCitationId === "ref-shared") {
        return {
          ...citation,
          canonicalWorkAliases: ["pmid:7", "doi:10.1000/b"] as typeof citation.canonicalWorkAliases,
        };
      }
      return citation;
    });
    const proposals = proposeCrossReviewLinks(sampleIndex.claims, conflicted, {
      similarityThreshold: 1,
    });
    expect(proposals.some((proposal) => proposal.proposedRelation === "shared-citations")).toBe(
      false,
    );
  });
});
