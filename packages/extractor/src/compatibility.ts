import {
  type CompatibilityLevel,
  type CompatibilityReport,
  type CompatibilitySignal,
  type InspectionReport,
} from "@oratlas/contracts";
import { type ExtractedKnowledge } from "./knowledge.js";

const TEMPLATE_FULL_NAME = "allenneuraldynamics/computationalreviewtemplate";

function signal(detected: boolean, evidence: string[]): CompatibilitySignal {
  return { detected, evidence };
}

/**
 * Transparent, rule-based structural compatibility classification (spec §7).
 * Every signal is a deterministic rule over the inspection report and extracted
 * knowledge — never an opaque language-model verdict. The report explains
 * exactly why a repository received its level.
 */
export function assessCompatibility(
  report: InspectionReport,
  knowledge: ExtractedKnowledge,
  manifestPresent: boolean,
): CompatibilityReport {
  if (report.status === "failed") {
    return inspectionFailed(report.error ?? "Inspection failed.");
  }

  const paths = new Set(report.tree.map((t) => t.path.toLowerCase()));
  const hasFile = (name: string) => paths.has(name.toLowerCase());
  const anyPath = (pred: (p: string) => boolean) => [...paths].some(pred);

  // 1. Template fork / template-instance
  const forkEvidence: string[] = [];
  const parentIsTemplate =
    report.parentFullName?.toLowerCase() === TEMPLATE_FULL_NAME ||
    report.templateFullName?.toLowerCase() === TEMPLATE_FULL_NAME;
  const isTemplateItself =
    `${report.repo.owner}/${report.repo.name}`.toLowerCase() === TEMPLATE_FULL_NAME;
  if (parentIsTemplate) forkEvidence.push("Repository is a fork/instance of ComputationalReviewTemplate.");
  if (isTemplateItself) forkEvidence.push("Repository is the ComputationalReviewTemplate itself.");
  const templateForkDetected = signal(parentIsTemplate || isTemplateItself, forkEvidence);

  // 2. Template structural files
  const templateFileEvidence: string[] = [];
  const hasMyst = hasFile("myst.yml") || hasFile("myst.yaml");
  const hasContentDir = anyPath((p) => p.startsWith("content/"));
  const hasProvenanceFile =
    anyPath((p) => p.endsWith("provenance.md") || p.endsWith("provenance.json"));
  const hasSkills = anyPath((p) => p.startsWith("skills/"));
  const hasPlugins = anyPath((p) => p.startsWith("plugins/"));
  if (hasMyst) templateFileEvidence.push("myst.yml present.");
  if (hasContentDir) templateFileEvidence.push("content/ directory present.");
  if (hasSkills) templateFileEvidence.push("skills/ directory present (template pipeline).");
  if (hasPlugins) templateFileEvidence.push("plugins/ directory present (template widgets).");
  const templateFilesDetected = signal(
    (hasMyst && hasContentDir) || hasSkills || hasPlugins,
    templateFileEvidence,
  );

  // 3. MyST project
  const mystProjectDetected = signal(
    hasMyst,
    hasMyst ? ["A MyST project configuration was found."] : ["No myst.yml/myst.yaml found."],
  );

  // 4. Bibliography
  const hasBib = anyPath((p) => p.endsWith(".bib"));
  const bibliographyDetected = signal(
    hasBib,
    hasBib ? ["A BibTeX bibliography (.bib) was found."] : ["No .bib bibliography found."],
  );

  // 5. Review content
  const hasReviewMd = anyPath(
    (p) =>
      (p.startsWith("content/") && p.endsWith(".md")) ||
      p.endsWith("evidence_database.md") ||
      /(^|\/)(introduction|methods|results|discussion)\.md$/.test(p),
  );
  const reviewContentDetected = signal(
    hasReviewMd || hasContentDir,
    hasReviewMd
      ? ["Review content Markdown/MyST files were found."]
      : ["No obvious review content files found."],
  );

  // 6. Provenance
  const provenanceDetected = signal(
    hasProvenanceFile,
    hasProvenanceFile ? ["A provenance file was found."] : ["No provenance file found."],
  );

  // 7. TRUST data
  const trustDataDetected = signal(
    knowledge.trust.length > 0,
    knowledge.trust.length > 0
      ? [`${knowledge.trust.length} TRUST assessment record(s) parsed.`]
      : ["No TRUST assessment records found."],
  );

  // 8. Release
  const hasRelease = report.releases.some((r) => !r.isDraft);
  const releaseDetected = signal(
    hasRelease,
    hasRelease
      ? [`GitHub release ${report.releases.find((r) => !r.isDraft)?.tagName} detected.`]
      : ["No published GitHub release found."],
  );

  // 9. DOI
  const manifestDoi = manifestPresent && anyPath((p) => p === "review-manifest.json");
  const releaseDoi = report.releases.some((r) => r.bodyDois.length > 0);
  const doiDetected = signal(
    manifestDoi || releaseDoi,
    [
      manifestDoi ? "review-manifest.json may declare a DOI." : "",
      releaseDoi ? "A DOI appears in a release body." : "",
    ].filter(Boolean),
  );

  const knowledgeArtifacts = knowledge.claims.length > 0 || knowledge.citations.length > 0;

  // --- Level decision (transparent) ---
  const rationale: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const blockingErrors: string[] = [];

  let level: CompatibilityLevel;
  if (templateForkDetected.detected && mystProjectDetected.detected) {
    level = "verified-template";
    rationale.push("Repository is the template or a fork/instance of it, with a MyST project.");
  } else if (
    mystProjectDetected.detected &&
    (reviewContentDetected.detected || bibliographyDetected.detected) &&
    (manifestPresent || knowledgeArtifacts || provenanceDetected.detected)
  ) {
    level = "compatible";
    rationale.push(
      "Structurally compatible: MyST project plus review content/bibliography and manifest or knowledge/provenance artifacts.",
    );
  } else if (
    reviewContentDetected.detected ||
    bibliographyDetected.detected ||
    mystProjectDetected.detected ||
    manifestPresent
  ) {
    level = "partially-compatible";
    rationale.push(
      "Some review signals present, but missing others (e.g. no manifest, no knowledge artifacts, or no MyST project).",
    );
  } else {
    level = "unsupported";
    rationale.push("No recognizable computational-review structure was detected.");
    blockingErrors.push(
      "Repository does not resemble a computational-review repository (no MyST project, review content, manifest, or knowledge artifacts).",
    );
  }

  // Recommendations (non-blocking)
  if (!manifestPresent) {
    recommendations.push(
      "Add a review-manifest.json to declare title, DOIs, and knowledge artifact paths precisely.",
    );
  }
  if (!hasRelease) {
    recommendations.push(
      "Publish a GitHub release so a specific reviewed version can be cited immutably.",
    );
  }
  if (!doiDetected.detected) {
    recommendations.push(
      "Connect the repository to Zenodo and publish a release to mint a DOI. See docs/doi-and-versioning.md.",
    );
  }
  if (!trustDataDetected.detected && knowledgeArtifacts) {
    warnings.push("Claims/citations found but no TRUST assessments were provided.");
  }
  if (report.status === "partial") {
    warnings.push(
      "Inspection was partial (size/rate limits); some signals may be incomplete. " +
        report.warnings.slice(0, 2).join(" "),
    );
  }

  return {
    schemaVersion: "1.0.0",
    templateForkDetected,
    templateFilesDetected,
    mystProjectDetected,
    bibliographyDetected,
    reviewContentDetected,
    provenanceDetected,
    trustDataDetected,
    releaseDetected,
    doiDetected,
    overallCompatibility: level,
    levelRationale: rationale,
    blockingErrors,
    warnings,
    recommendations,
  };
}

function inspectionFailed(error: string): CompatibilityReport {
  const empty = signal(false, []);
  return {
    schemaVersion: "1.0.0",
    templateForkDetected: empty,
    templateFilesDetected: empty,
    mystProjectDetected: empty,
    bibliographyDetected: empty,
    reviewContentDetected: empty,
    provenanceDetected: empty,
    trustDataDetected: empty,
    releaseDetected: empty,
    doiDetected: empty,
    overallCompatibility: "inspection-failed",
    levelRationale: ["Inspection failed; compatibility could not be assessed."],
    blockingErrors: [error],
    warnings: [],
    recommendations: [],
  };
}
