import { describe, expect, it } from "vitest";
import { KNOWLEDGE_NODE_KINDS, knowledgeNodeKindSchema } from "./enums.js";

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
