import { describe, expect, it } from "vitest";
import {
  circularCitations,
  differingScopeFields,
  evidenceFamilies,
  synthesize,
  type SynthesisCitation,
  type SynthesisStatement,
} from "./synthesis.js";

function citation(
  overrides: Partial<SynthesisCitation> & { citationId: string },
): SynthesisCitation {
  return {
    datasetIds: [],
    derivedFromDois: [],
    isExample: false,
    ...overrides,
  };
}

describe("evidenceFamilies", () => {
  it("groups works sharing a dataset into one family", () => {
    const families = evidenceFamilies([
      citation({ citationId: "c1", doi: "10.1234/a", datasetIds: ["GSE123"] }),
      citation({ citationId: "c2", doi: "10.1234/b", datasetIds: ["gse123 "] }),
      citation({ citationId: "c3", doi: "10.1234/c" }),
    ]);
    expect(families.get("doi:10.1234/a")).toBe(families.get("doi:10.1234/b"));
    expect(families.get("doi:10.1234/c")).not.toBe(families.get("doi:10.1234/a"));
  });

  it("groups a derivative analysis with its source work", () => {
    const families = evidenceFamilies([
      citation({ citationId: "c1", doi: "10.1234/source" }),
      citation({ citationId: "c2", doi: "10.1234/derived", derivedFromDois: ["10.1234/SOURCE"] }),
    ]);
    expect(families.get("doi:10.1234/source")).toBe(families.get("doi:10.1234/derived"));
  });
});

describe("circularCitations", () => {
  it("flags citations pointing back at archived review versions", () => {
    const circular = circularCitations(
      [
        citation({ citationId: "c1", doi: "10.5281/zenodo.9" }),
        citation({ citationId: "c2", doi: "10.1234/x" }),
      ],
      [{ doi: "10.5281/zenodo.9", reviewSlug: "prior-review" }],
    );
    expect(circular.get("c1")).toBe("prior-review");
    expect(circular.has("c2")).toBe(false);
  });
});

describe("differingScopeFields", () => {
  it("lists only fields both declare with different values", () => {
    expect(
      differingScopeFields(
        { population: "adult mice", outcome: "recall" },
        { population: "juvenile mice", outcome: "recall" },
      ),
    ).toEqual(["population"]);
    expect(differingScopeFields({ population: "x" }, undefined)).toEqual([]);
  });
});

describe("synthesize", () => {
  const citations = [
    citation({ citationId: "c1", doi: "10.1234/a", datasetIds: ["D1"] }),
    citation({ citationId: "c2", doi: "10.1234/b", datasetIds: ["D1"] }), // same family as c1
    citation({ citationId: "c3", doi: "10.1234/c" }), // independent
  ];

  it("counts independent families, not raw supporting works", () => {
    const statements: SynthesisStatement[] = [
      {
        claimId: "claim:A",
        reviewSlug: "r",
        reviewVersionId: "v",
        localClaimId: "a",
        text: "Effect holds.",
        evidence: [
          { citationId: "c1", relationType: "supports" },
          { citationId: "c2", relationType: "supports" },
          { citationId: "c3", relationType: "supports" },
        ],
      },
    ];
    const result = synthesize(statements, citations);
    const summary = result.statements[0]!.summary;
    expect(summary.supportingWorks).toBe(3);
    // c1 and c2 share dataset D1 → one family; c3 independent → 2 families.
    expect(summary.independentSupportingFamilies).toBe(2);
  });

  it("separates genuine contradiction from scope difference", () => {
    const base = { reviewSlug: "r", reviewVersionId: "v", localClaimId: "x" };
    const supports: SynthesisStatement = {
      ...base,
      claimId: "claim:S",
      localClaimId: "s",
      text: "Sorters match manual curation.",
      evidence: [{ citationId: "c3", relationType: "supports" }],
    };
    const opposes: SynthesisStatement = {
      ...base,
      claimId: "claim:O",
      localClaimId: "o",
      text: "Sorters do not match manual curation.",
      evidence: [{ citationId: "c3", relationType: "contradicts" }],
    };
    const genuine = synthesize([supports, opposes], citations);
    expect(genuine.contradictions).toHaveLength(1);
    expect(genuine.contradictions[0]!.kind).toBe("genuine-contradiction-shared-evidence");
    expect(genuine.contradictions[0]!.sharedFamilyCount).toBe(1);

    const scopedOpposes: SynthesisStatement = {
      ...opposes,
      scope: { population: "chronic recordings" },
    };
    const scopedSupports: SynthesisStatement = {
      ...supports,
      scope: { population: "acute recordings" },
    };
    const scoped = synthesize([scopedSupports, scopedOpposes], citations);
    expect(scoped.contradictions[0]!.kind).toBe("scope-difference");
    expect(scoped.contradictions[0]!.differingScopeFields).toEqual(["population"]);
  });

  it("marks contradictions over disjoint families as independent evidence", () => {
    const twoWorks = [
      citation({ citationId: "s1", doi: "10.1234/support" }),
      citation({ citationId: "o1", doi: "10.1234/oppose" }),
    ];
    const supports: SynthesisStatement = {
      claimId: "claim:S",
      reviewSlug: "r",
      reviewVersionId: "v",
      localClaimId: "s",
      text: "Holds.",
      evidence: [{ citationId: "s1", relationType: "supports" }],
    };
    const opposes: SynthesisStatement = {
      claimId: "claim:O",
      reviewSlug: "r2",
      reviewVersionId: "v2",
      localClaimId: "o",
      text: "Does not hold.",
      evidence: [{ citationId: "o1", relationType: "contradicts" }],
    };
    const result = synthesize([supports, opposes], twoWorks);
    expect(result.contradictions[0]!.kind).toBe("contradiction-independent-evidence");
    expect(result.contradictions[0]!.sharedFamilyCount).toBe(0);
  });

  it("excludes circular citations from independent counts", () => {
    const withCircular = [citation({ citationId: "c1", doi: "10.5281/zenodo.9" })];
    const statement: SynthesisStatement = {
      claimId: "claim:A",
      reviewSlug: "r",
      reviewVersionId: "v",
      localClaimId: "a",
      text: "Holds.",
      evidence: [{ citationId: "c1", relationType: "supports" }],
    };
    const result = synthesize([statement], withCircular, [
      { doi: "10.5281/zenodo.9", reviewSlug: "prior" },
    ]);
    expect(result.statements[0]!.summary.independentSupportingFamilies).toBe(0);
    expect(result.statements[0]!.summary.circularCitationIds).toEqual(["c1"]);
  });
});
