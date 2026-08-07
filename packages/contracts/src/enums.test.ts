import { describe, expect, it } from "vitest";
import {
  CLAIM_TYPES,
  KNOWLEDGE_NODE_KINDS,
  claimTypeSchema,
  knowledgeNodeKindSchema,
  reviewTypeSchema,
} from "./enums.js";

describe("knowledge node kinds", () => {
  it("includes review and cited-work identities in the canonical graph vocabulary", () => {
    expect(KNOWLEDGE_NODE_KINDS).toEqual(["claim", "figure", "dataset", "code", "review", "work"]);
    expect(knowledgeNodeKindSchema.parse("review")).toBe("review");
    expect(knowledgeNodeKindSchema.parse("work")).toBe("work");
  });

  it("keeps presentation records outside the node-kind vocabulary", () => {
    expect(knowledgeNodeKindSchema.safeParse("landscape-card").success).toBe(false);
  });
});

describe("source-derived POC vocabularies", () => {
  it("represents synthesis and capability claims in the public contract", () => {
    for (const claimType of [
      "synthesis",
      "model-derived",
      "translational",
      "study-design",
      "resource-capability",
      "hypothesis-capability",
      "provenance-limitation",
    ] as const) {
      expect(CLAIM_TYPES).toContain(claimType);
      expect(claimTypeSchema.parse(claimType)).toBe(claimType);
    }
  });

  it("represents data releases without treating them as completed reviews", () => {
    expect(reviewTypeSchema.parse("data-release")).toBe("data-release");
  });
});
