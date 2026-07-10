import { type InspectionReport, type ReviewManifest } from "@oratlas/contracts";
import { extractMetadata, type ExtractionResult } from "./extract.js";
import { extractKnowledge, type ExtractedKnowledge } from "./knowledge.js";
import { assessCompatibility } from "./compatibility.js";
import { parseManifest } from "./sources.js";

export { EXTRACTOR_VERSION } from "./version.js";
export { extractMetadata, type ExtractionResult } from "./extract.js";
export { extractKnowledge, type ExtractedKnowledge } from "./knowledge.js";
export { assessCompatibility } from "./compatibility.js";
export * from "./sources.js";

export interface FullExtraction extends ExtractionResult {
  manifest?: ReviewManifest;
  knowledge: ExtractedKnowledge;
  compatibility: ReturnType<typeof assessCompatibility>;
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
  const knowledge = extractKnowledge(report, manifest);
  const compatibility = assessCompatibility(report, knowledge, metaResult.manifestPresent);

  return {
    ...metaResult,
    manifest,
    knowledge,
    compatibility,
  };
}
