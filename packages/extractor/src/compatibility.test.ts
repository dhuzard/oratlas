import { describe, expect, it } from "vitest";
import type {
  CitationRecord,
  ClaimRecord,
  InspectionReport,
  RelationRecord,
  TrustAssessmentRecord,
} from "@oratlas/contracts";
import { assessCompatibility } from "./compatibility.js";
import type { ExtractedKnowledge } from "./knowledge.js";
import { createEmptyNodeExtractionReport } from "./nodes.js";

const claim: ClaimRecord = { id: "claim-1", text: "A bounded claim." };
const citation: CitationRecord = { id: "citation-1", title: "A source" };
const relation: RelationRecord = {
  claimId: claim.id,
  citationId: citation.id,
  relationType: "supports",
};
const trust: TrustAssessmentRecord = {
  claimId: claim.id,
  citationId: citation.id,
  protocolVersion: "trust-poc-1.0",
  reviewStatus: "human-reviewed",
  assessorType: "human",
  criteria: {},
};

describe("per-facet compatibility", () => {
  it("classifies a prose-only repository without changing its scalar level", () => {
    const result = assessCompatibility(
      report(["content/introduction.md"]),
      emptyKnowledge(),
      false,
    );

    expect(result.overallCompatibility).toBe("partially-compatible");
    expect(result.facets).toEqual({
      article: {
        status: "available",
        evidence: ["Review content Markdown/MyST files were found."],
      },
      citations: {
        status: "unavailable",
        evidence: ["No bibliography or structured citation records were detected."],
      },
      evidencePackage: {
        status: "unavailable",
        evidence: ["No evidence-package inputs were detected."],
      },
      claimGraph: {
        status: "unavailable",
        evidence: ["No valid claims, knowledge nodes, relations, or edges were found."],
      },
      assessments: {
        status: "unavailable",
        evidence: ["No TRUST assessment records were found."],
      },
    });
  });

  it("classifies nodes-only input as a partial graph while preserving node compatibility", () => {
    const nodes = createEmptyNodeExtractionReport();
    nodes.manifest.status = "ok";
    nodes.counts.ok = 2;

    const result = assessCompatibility(
      report(["node-manifest.json"]),
      emptyKnowledge(),
      false,
      nodes,
    );

    expect(result.overallCompatibility).toBe("compatible");
    expect(result.facets?.claimGraph).toEqual({
      status: "partial",
      evidence: [
        "0 claim record(s) and 2 valid node(s) parsed, but no valid relations or edges were found.",
      ],
    });
    expect(result.facets?.article.status).toBe("unavailable");
  });

  it("separates a usable evidence graph from absent TRUST assessments", () => {
    const knowledge = emptyKnowledge({
      claims: [claim],
      citations: [citation],
      relations: [relation],
    });
    const result = assessCompatibility(
      report(["myst.yml", "content/review.md", "references.bib"]),
      knowledge,
      true,
    );

    expect(result.overallCompatibility).toBe("compatible");
    expect(result.facets?.evidencePackage.status).toBe("available");
    expect(result.facets?.claimGraph.status).toBe("available");
    expect(result.facets?.assessments.status).toBe("unavailable");
  });

  it("classifies the full fixture deterministically", () => {
    const knowledge = emptyKnowledge({
      claims: [claim],
      citations: [citation],
      relations: [relation],
      trust: [trust],
    });
    const inspection = report(["myst.yml", "content/review.md", "references.bib"]);
    const first = assessCompatibility(inspection, knowledge, true);
    const second = assessCompatibility(inspection, knowledge, true);

    expect(first).toEqual(second);
    expect(first.overallCompatibility).toBe("compatible");
    expect(Object.values(first.facets ?? {}).map((entry) => entry.status)).toEqual([
      "available",
      "available",
      "available",
      "available",
      "available",
    ]);
  });

  it("fails closed to unknown facets when inspection fails", () => {
    const failed = { ...report([]), status: "failed" as const, error: "transport failed" };
    const result = assessCompatibility(failed, emptyKnowledge(), false);
    expect(result.overallCompatibility).toBe("inspection-failed");
    expect(new Set(Object.values(result.facets ?? {}).map((entry) => entry.status))).toEqual(
      new Set(["unknown"]),
    );
  });
});

function emptyKnowledge(overrides: Partial<ExtractedKnowledge> = {}): ExtractedKnowledge {
  return { claims: [], citations: [], relations: [], trust: [], warnings: [], ...overrides };
}

function report(paths: string[]): InspectionReport {
  return {
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: "fixture",
      name: "review",
      canonicalUrl: "https://github.com/fixture/review",
    },
    inspectedAt: "2026-01-01T00:00:00.000Z",
    status: "succeeded",
    topics: [],
    tags: [],
    releases: [],
    tree: paths.map((path) => ({ path, size: 1 })),
    treeTruncated: false,
    files: {},
    warnings: [],
    limits: {
      maxFileBytes: 1_000_000,
      maxTotalBytes: 10_000_000,
      maxFileCount: 1_000,
      totalBytesFetched: 0,
      filesFetched: 0,
    },
  };
}
