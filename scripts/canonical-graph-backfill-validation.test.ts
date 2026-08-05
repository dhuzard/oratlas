import { describe, expect, it } from "vitest";
import {
  canonicalValidationTotal,
  countMissingReviewAssertions,
} from "./canonical-graph-backfill-validation.js";

describe("canonical graph backfill validation categories", () => {
  it("does not count an absent exact claim binding again as an absent assertion", () => {
    const claims = [
      { id: "unbound", knowledgeNodeId: null, graphVersion: null },
      { id: "bound", knowledgeNodeId: "node-1", graphVersion: { id: "version-1" } },
    ];
    expect(countMissingReviewAssertions(claims, [])).toBe(1);
    expect(
      canonicalValidationTotal({
        missingReviewBinding: 0,
        missingReviewVersionBinding: 0,
        missingClaimBindings: 1,
        missingReviewAssertionBindings: 1,
        missingCitationBindings: 0,
        missingRelationBindings: 0,
        semanticMismatchCount: 0,
      }),
    ).toBe(2);
  });
});
