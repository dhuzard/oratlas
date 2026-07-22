import { createHash } from "node:crypto";
import {
  sourceAssessmentDocumentsReportSchema,
  type InspectionReport,
  type SourceAssessmentDocument,
  type SourceAssessmentDocumentsReport,
} from "@oratlas/contracts";
import { EXTRACTOR_VERSION } from "./version.js";

const DOCUMENTS = [
  { kind: "trust" as const, path: "TRUST.md" as const },
  { kind: "fair" as const, path: "FAIR.md" as const },
];

/**
 * Describe exact root source documents without interpreting their Markdown.
 * Their content remains in the bounded inspection capture and durable
 * preserved-file package rather than being duplicated into this report.
 */
export function extractSourceAssessmentDocuments(
  report: InspectionReport,
): SourceAssessmentDocumentsReport {
  const commitSha = report.selectedSource?.commitSha ?? report.latestCommitSha;
  if (!commitSha) {
    throw new Error("Source assessment documents require an immutable source commit.");
  }
  const treeSizes = new Map(report.tree.map((entry) => [entry.path, entry.size]));
  const documents: SourceAssessmentDocument[] = DOCUMENTS.map(({ kind, path }) => {
    const file = report.files[path];
    const provenance = {
      source: "repository-file" as const,
      commitSha,
      extractorVersion: EXTRACTOR_VERSION,
    };
    if (file?.content !== undefined && !file.truncated) {
      return {
        kind,
        path,
        status: "preserved" as const,
        size: Buffer.byteLength(file.content, "utf8"),
        contentHash: createHash("sha256").update(file.content, "utf8").digest("hex"),
        provenance,
      };
    }
    if (treeSizes.has(path)) {
      return {
        kind,
        path,
        status: "unavailable" as const,
        size: file?.size ?? treeSizes.get(path),
        provenance,
      };
    }
    return { kind, path, status: "absent" as const, provenance };
  });
  return sourceAssessmentDocumentsReportSchema.parse({ schemaVersion: "1.0.0", documents });
}
