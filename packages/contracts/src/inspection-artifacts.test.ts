import { describe, expect, it } from "vitest";
import {
  artifactKindSchema,
  artifactOutcomesSchema,
  compatibilityReportSchema,
} from "./inspection.js";

const notDeclared = {
  status: "not-declared" as const,
  loadedCount: 0 as const,
  skippedCount: 0 as const,
  sources: [],
};

describe("artifact compatibility outcomes", () => {
  it("requires an honest outcome for all six artifact types", () => {
    const outcomes = Object.fromEntries(
      artifactKindSchema.options.map((kind) => [kind, notDeclared]),
    );
    expect(artifactOutcomesSchema.parse(outcomes)).toEqual(outcomes);
  });

  it("distinguishes a valid empty source from an unknowably skipped source", () => {
    expect(
      artifactOutcomesSchema.shape.claims.safeParse({
        status: "loaded",
        loadedCount: 0,
        skippedCount: 0,
        sources: [
          {
            status: "loaded",
            path: "claims.jsonl",
            discovery: "declared",
            loadedCount: 0,
            skippedCount: 0,
            issues: [],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      artifactOutcomesSchema.shape.claims.safeParse({
        status: "skipped",
        loadedCount: 0,
        skippedCount: null,
        sources: [
          {
            status: "skipped",
            path: "claims.jsonl",
            discovery: "declared",
            loadedCount: 0,
            skippedCount: null,
            issues: [{ code: "source-not-fetched", message: "Source bytes were unavailable." }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("keeps legacy 1.0 reports parseable without inventing outcomes", () => {
    const signal = { detected: false, evidence: [] };
    const parsed = compatibilityReportSchema.parse({
      schemaVersion: "1.0.0",
      templateForkDetected: signal,
      templateFilesDetected: signal,
      mystProjectDetected: signal,
      bibliographyDetected: signal,
      reviewContentDetected: signal,
      provenanceDetected: signal,
      trustDataDetected: signal,
      releaseDetected: signal,
      doiDetected: signal,
      overallCompatibility: "unsupported",
      levelRationale: [],
    });
    expect(parsed).not.toHaveProperty("artifactOutcomes");
  });
});
