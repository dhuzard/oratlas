import { describe, expect, it } from "vitest";
import {
  artifactKindSchema,
  artifactOutcomesSchema,
  compatibilityReportSchema,
  legacyCompatibilityReportSchema,
} from "./inspection.js";

const notDeclared = {
  status: "not-declared" as const,
  loadedCount: 0 as const,
  skippedCount: 0 as const,
  sources: [],
};

describe("artifactOutcomesSchema", () => {
  it("requires an honest outcome for all six artifact types", () => {
    expect(
      artifactOutcomesSchema.parse({
        claims: notDeclared,
        citations: notDeclared,
        relations: notDeclared,
        trust: notDeclared,
        nodes: notDeclared,
        edges: notDeclared,
      }),
    ).toBeDefined();
  });

  it.each(artifactKindSchema.options)("accepts all four honest outcomes for %s", (kind) => {
    const issue = { code: "source-unavailable", message: "The source was unavailable." };
    const cases = [
      notDeclared,
      {
        status: "loaded",
        loadedCount: 0,
        skippedCount: 0,
        sources: [
          {
            status: "loaded",
            path: `${kind}.jsonl`,
            discovery: "declared",
            loadedCount: 0,
            skippedCount: 0,
            issues: [],
          },
        ],
      },
      {
        status: "skipped",
        loadedCount: 0,
        skippedCount: null,
        sources: [
          {
            status: "skipped",
            path: `${kind}.jsonl`,
            discovery: "declared",
            loadedCount: 0,
            skippedCount: null,
            issues: [issue],
          },
        ],
      },
      {
        status: "invalid",
        loadedCount: 0,
        skippedCount: 1,
        sources: [
          {
            status: "invalid",
            path: `${kind}.jsonl`,
            discovery: "discovered",
            loadedCount: 0,
            skippedCount: 1,
            issues: [issue],
          },
        ],
      },
    ];
    for (const outcome of cases) {
      expect(artifactOutcomesSchema.shape[kind].safeParse(outcome).success).toBe(true);
    }
  });

  it("distinguishes valid empty, invalid, and unknowably skipped sources", () => {
    const sources = [
      {
        status: "loaded",
        path: "claims.jsonl",
        discovery: "declared",
        loadedCount: 0,
        skippedCount: 0,
        issues: [],
      },
      {
        status: "invalid",
        path: "citations.jsonl",
        discovery: "discovered",
        loadedCount: 0,
        skippedCount: 2,
        issues: [{ code: "record-invalid", message: "Two records were invalid." }],
      },
      {
        status: "skipped",
        path: "trust.jsonl",
        discovery: "declared",
        loadedCount: 0,
        skippedCount: null,
        issues: [{ code: "source-not-fetched", message: "Source bytes were unavailable." }],
      },
    ];
    for (const source of sources) {
      const status = source.status === "loaded" ? "loaded" : source.status;
      const parsed = artifactOutcomesSchema.shape.claims.parse({
        status,
        loadedCount: 0,
        skippedCount: source.skippedCount,
        sources: [source],
      });
      expect(parsed.status).toBe(status);
    }
  });
});

describe("compatibilityReportSchema versions", () => {
  it("keeps legacy 1.0 reports parseable without guessing outcomes", () => {
    const signal = { detected: false, evidence: [] };
    const legacy = {
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
      blockingErrors: [],
      warnings: [],
      recommendations: [],
    };
    expect(legacyCompatibilityReportSchema.safeParse(legacy).success).toBe(true);
    expect(compatibilityReportSchema.parse(legacy)).not.toHaveProperty("artifactOutcomes");
  });
});
