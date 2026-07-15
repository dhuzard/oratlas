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

  it("does not union works over low-entropy dataset labels", () => {
    const families = evidenceFamilies([
      citation({ citationId: "c1", doi: "10.1234/a", datasetIds: ["controls"] }),
      citation({ citationId: "c2", doi: "10.1234/b", datasetIds: ["controls"] }),
    ]);
    expect(families.get("doi:10.1234/a")).not.toBe(families.get("doi:10.1234/b"));
  });

  it("unions works over accession-like dataset ids", () => {
    const families = evidenceFamilies([
      citation({ citationId: "c1", doi: "10.1234/a", datasetIds: ["GSE12345"] }),
      citation({ citationId: "c2", doi: "10.1234/b", datasetIds: ["gse12345"] }),
    ]);
    expect(families.get("doi:10.1234/a")).toBe(families.get("doi:10.1234/b"));
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
    citation({ citationId: "c1", doi: "10.1234/a", datasetIds: ["GSE1001"] }),
    citation({ citationId: "c2", doi: "10.1234/b", datasetIds: ["GSE1001"] }), // same family as c1
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
      scope: { population: "dense probes" },
      evidence: [{ citationId: "c3", relationType: "supports" }],
    };
    const opposes: SynthesisStatement = {
      ...base,
      claimId: "claim:O",
      localClaimId: "o",
      text: "Sorters do not match manual curation.",
      scope: { population: "dense probes" },
      evidence: [{ citationId: "c3", relationType: "contradicts" }],
    };
    const genuine = synthesize([supports, opposes], citations);
    expect(genuine.contradictions).toHaveLength(1);
    expect(genuine.contradictions[0]!.kind).toBe("genuine-contradiction");
    expect(genuine.contradictions[0]!.sharedFamilyCount).toBe(1);

    // Same evidence and directions, but neither claim declares a scope.
    const undeclared = synthesize(
      [
        { ...supports, scope: undefined },
        { ...opposes, scope: undefined },
      ],
      citations,
    );
    expect(undeclared.contradictions[0]!.kind).toBe("undetermined-scope");

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

  it("does not pair claims whose evidence never overlaps", () => {
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
    // Opposite directions but disjoint evidence families → not a contradiction.
    expect(synthesize([supports, opposes], twoWorks).contradictions).toHaveLength(0);
  });

  it("counts a shared family once when both claims declare both directions", () => {
    const statement = (claimId: string): SynthesisStatement => ({
      claimId,
      reviewSlug: "r",
      reviewVersionId: "v",
      localClaimId: claimId,
      text: "Mixed evidence.",
      evidence: [
        { citationId: "c3", relationType: "supports" },
        { citationId: "c3", relationType: "contradicts" },
      ],
    });
    const result = synthesize([statement("claim:A"), statement("claim:B")], citations);

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]!.sharedFamilyCount).toBe(1);
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

  it("counts one circular citation once even when the claim declares multiple relations", () => {
    const withCircular = [citation({ citationId: "c1", doi: "10.5281/zenodo.9" })];
    const statement: SynthesisStatement = {
      claimId: "claim:A",
      reviewSlug: "r",
      reviewVersionId: "v",
      localClaimId: "a",
      text: "Holds with qualifications.",
      evidence: [
        { citationId: "c1", relationType: "supports" },
        { citationId: "c1", relationType: "contradicts" },
      ],
    };
    const result = synthesize([statement], withCircular, [
      { doi: "10.5281/zenodo.9", reviewSlug: "prior" },
    ]);
    expect(result.statements[0]!.summary.circularCitationIds).toEqual(["c1"]);
  });
});
