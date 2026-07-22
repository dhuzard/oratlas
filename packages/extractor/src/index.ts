import { type InspectionReport, type ReviewManifest } from "@oratlas/contracts";
import { extractMetadata, type ExtractionResult } from "./extract.js";
import { extractKnowledgeWithOutcomes, type ExtractedKnowledge } from "./knowledge.js";
import { assessCompatibility } from "./compatibility.js";
import { extractKnowledgeNodes, type NodeExtractionReport } from "./nodes.js";
import { parseManifest } from "./sources.js";
import { extractSourceAssessmentDocuments } from "./source-assessment-documents.js";
import { type SourceAssessmentDocumentsReport } from "@oratlas/contracts";

export { EXTRACTOR_VERSION } from "./version.js";
export { extractMetadata, type ExtractionResult } from "./extract.js";
export {
  extractKnowledge,
  extractKnowledgeWithOutcomes,
  type ExtractedKnowledge,
  type KnowledgeArtifactOutcomes,
  type KnowledgeExtractionResult,
} from "./knowledge.js";
export { assessCompatibility } from "./compatibility.js";
export { createEmptyNodeExtractionReport, extractKnowledgeNodes } from "./nodes.js";
export {
  extractedEdgeRecordSchema,
  extractedNodeRecordSchema,
  nodeDoiReferenceSchema,
  nodeExtractionIssueSchema,
  nodeExtractionReportSchema,
  nodeFieldProvenanceSchema,
  nodeRecordStatusSchema,
} from "./nodes.js";
export type {
  ExtractedEdgeRecord,
  ExtractedNodeRecord,
  NodeDoiReference,
  NodeExtractionIssue,
  NodeExtractionReport,
  NodeFieldProvenance,
  NodeRecordStatus,
} from "./nodes.js";
export * from "./sources.js";
export { extractSourceAssessmentDocuments } from "./source-assessment-documents.js";

export interface FullExtraction extends ExtractionResult {
  manifest?: ReviewManifest;
  knowledge: ExtractedKnowledge;
  nodeExtraction: NodeExtractionReport;
  compatibility: ReturnType<typeof assessCompatibility>;
  sourceAssessmentDocuments?: SourceAssessmentDocumentsReport;
}

/**
 * Run the full deterministic extraction pipeline over an inspection report:
 * metadata (with provenance) + knowledge artifacts + compatibility report.
 */
export function runExtraction(
  report: InspectionReport,
  now: () => Date = () => new Date(),
): FullExtraction {
  const manifestContent = report.files["review-manifest.json"]?.content;
  const manifest = manifestContent ? parseManifest(manifestContent).manifest : undefined;

  const metaResult = extractMetadata(report, now);
  const nodeExtraction = extractKnowledgeNodes(report);
  const knowledgeResult = extractKnowledgeWithOutcomes(report, manifest, nodeExtraction);
  const knowledge = knowledgeResult.knowledge;
  const compatibility = assessCompatibility(
    report,
    knowledge,
    metaResult.manifestPresent,
    nodeExtraction,
    knowledgeResult.artifactOutcomes,
  );
  const sourceAssessmentDocuments =
    report.selectedSource?.commitSha || report.latestCommitSha
      ? extractSourceAssessmentDocuments(report)
      : undefined;

  return {
    ...metaResult,
    manifest,
    knowledge,
    nodeExtraction,
    compatibility,
    sourceAssessmentDocuments,
  };
}
