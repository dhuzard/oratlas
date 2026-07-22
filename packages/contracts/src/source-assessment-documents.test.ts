import { describe, expect, it } from "vitest";
import { sourceAssessmentDocumentsReportSchema } from "./source-assessment-documents.js";

const commitSha = "a".repeat(40);
const provenance = {
  source: "repository-file" as const,
  commitSha,
  extractorVersion: "test",
};

describe("source assessment document report", () => {
  it("accepts only the two exact root document paths", () => {
    const valid = {
      schemaVersion: "1.0.0",
      documents: [
        { kind: "trust", path: "TRUST.md", status: "absent", provenance },
        { kind: "fair", path: "FAIR.md", status: "absent", provenance },
      ],
    };
    expect(sourceAssessmentDocumentsReportSchema.safeParse(valid).success).toBe(true);
    expect(
      sourceAssessmentDocumentsReportSchema.safeParse({
        ...valid,
        documents: [
          { kind: "trust", path: "../TRUST.md", status: "preserved", provenance },
          valid.documents[1],
        ],
      }).success,
    ).toBe(false);
  });
});
