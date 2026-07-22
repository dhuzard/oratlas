import { describe, expect, it } from "vitest";
import {
  compatibilityReportSchema,
  facetCompatibilityReportSchema,
  facetCompatibilitySchema,
} from "./inspection.js";

const complete = {
  article: { status: "available", evidence: ["Review prose was found."] },
  citations: { status: "partial", evidence: ["One citation record was parsed."] },
  evidencePackage: { status: "unavailable", evidence: ["No evidence package was found."] },
  claimGraph: { status: "available", evidence: ["One claim node was parsed."] },
  assessments: { status: "unknown", evidence: ["Inspection failed."] },
} as const;

describe("facet compatibility contracts", () => {
  it("accepts the five fixed facets and evidence-backed statuses", () => {
    expect(facetCompatibilityReportSchema.parse(complete)).toEqual(complete);
  });

  it("rejects a status without evidence", () => {
    expect(facetCompatibilitySchema.safeParse({ status: "available", evidence: [] }).success).toBe(
      false,
    );
  });

  it("keeps legacy scalar reports readable without inventing facets", () => {
    const parsed = compatibilityReportSchema.parse({
      schemaVersion: "1.0.0",
      templateForkDetected: { detected: false, evidence: [] },
      templateFilesDetected: { detected: false, evidence: [] },
      mystProjectDetected: { detected: false, evidence: [] },
      bibliographyDetected: { detected: false, evidence: [] },
      reviewContentDetected: { detected: false, evidence: [] },
      provenanceDetected: { detected: false, evidence: [] },
      trustDataDetected: { detected: false, evidence: [] },
      releaseDetected: { detected: false, evidence: [] },
      doiDetected: { detected: false, evidence: [] },
      overallCompatibility: "partially-compatible",
      levelRationale: ["Legacy report."],
    });
    expect(parsed.overallCompatibility).toBe("partially-compatible");
    expect(parsed.facets).toBeUndefined();
  });
});
