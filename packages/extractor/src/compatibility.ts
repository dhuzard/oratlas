import {
  type CompatibilityLevel,
  type CompatibilityReport,
  type CompatibilitySignal,
  type FacetCompatibility,
  type FacetCompatibilityReport,
  type InspectionReport,
} from "@oratlas/contracts";
import { type ExtractedKnowledge } from "./knowledge.js";
import { type NodeExtractionReport } from "./nodes.js";

const TEMPLATE_FULL_NAME = "allenneuraldynamics/computationalreviewtemplate";

function signal(detected: boolean, evidence: string[]): CompatibilitySignal {
  return { detected, evidence };
}

function facet(status: FacetCompatibility["status"], ...evidence: string[]): FacetCompatibility {
  return { status, evidence };
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
  nodeExtraction?: NodeExtractionReport,
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
  if (parentIsTemplate)
    forkEvidence.push("Repository is a fork/instance of ComputationalReviewTemplate.");
  if (isTemplateItself) forkEvidence.push("Repository is the ComputationalReviewTemplate itself.");
  const templateForkDetected = signal(parentIsTemplate || isTemplateItself, forkEvidence);

  // 2. Template structural files
  const templateFileEvidence: string[] = [];
  const hasMyst = hasFile("myst.yml") || hasFile("myst.yaml");
  const hasContentDir = anyPath((p) => p.startsWith("content/"));
  const hasProvenanceFile = anyPath(
    (p) => p.endsWith("provenance.md") || p.endsWith("provenance.json"),
  );
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

  const validNodeDeclarations =
    nodeExtraction?.manifest.status === "ok" && nodeExtraction.counts.ok > 0;

  // 9. DOI
  const manifestDoi = manifestPresent && anyPath((p) => p === "review-manifest.json");
  const releaseDoi = report.releases.some((r) => r.bodyDois.length > 0);
  const nodeDoi =
    nodeExtraction?.nodes.some(
      (record) => record.status === "ok" && record.doiReferences.length > 0,
    ) ?? false;
  const doiDetected = signal(
    manifestDoi || releaseDoi || nodeDoi,
    [
      manifestDoi ? "review-manifest.json may declare a DOI." : "",
      releaseDoi ? "A DOI appears in a release body." : "",
      nodeDoi ? "A valid first-class node declares a DOI." : "",
    ].filter(Boolean),
  );

  const legacyKnowledgeArtifacts = knowledge.claims.length > 0 || knowledge.citations.length > 0;
  const knowledgeArtifacts = legacyKnowledgeArtifacts || validNodeDeclarations;

  const facets = assessFacets({
    manifestPresent,
    mystProjectDetected,
    bibliographyDetected,
    reviewContentDetected,
    provenanceDetected,
    knowledge,
    nodeExtraction,
  });

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
  } else if (validNodeDeclarations) {
    level = "compatible";
    rationale.push(
      `Node-publication compatible: ${nodeExtraction.counts.ok} valid first-class knowledge node(s) were deterministically extracted.`,
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
  if (!manifestPresent && !validNodeDeclarations) {
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
  if (!trustDataDetected.detected && legacyKnowledgeArtifacts) {
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
    facets,
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
    facets: {
      article: facet("unknown", "Article compatibility is unknown because inspection failed."),
      citations: facet("unknown", "Citation compatibility is unknown because inspection failed."),
      evidencePackage: facet(
        "unknown",
        "Evidence-package compatibility is unknown because inspection failed.",
      ),
      claimGraph: facet(
        "unknown",
        "Claim-graph compatibility is unknown because inspection failed.",
      ),
      assessments: facet(
        "unknown",
        "Assessment compatibility is unknown because inspection failed.",
      ),
    },
    overallCompatibility: "inspection-failed",
    levelRationale: ["Inspection failed; compatibility could not be assessed."],
    blockingErrors: [error],
    warnings: [],
    recommendations: [],
  };
}

interface FacetInputs {
  manifestPresent: boolean;
  mystProjectDetected: CompatibilitySignal;
  bibliographyDetected: CompatibilitySignal;
  reviewContentDetected: CompatibilitySignal;
  provenanceDetected: CompatibilitySignal;
  knowledge: ExtractedKnowledge;
  nodeExtraction?: NodeExtractionReport;
}

/**
 * Derive independent capability availability from already validated extraction
 * outputs. These rules do not affect the legacy scalar acceptance decision.
 */
function assessFacets(input: FacetInputs): FacetCompatibilityReport {
  const { knowledge, nodeExtraction } = input;
  const validNodes = nodeExtraction?.counts.ok ?? 0;
  const validEdges = nodeExtraction?.counts.edgesOk ?? 0;

  const article = input.reviewContentDetected.detected
    ? facet("available", ...input.reviewContentDetected.evidence)
    : input.mystProjectDetected.detected || input.manifestPresent
      ? facet(
          "partial",
          input.mystProjectDetected.detected
            ? "A MyST project was found, but no review prose was detected."
            : "A review manifest was parsed, but no review prose was detected.",
        )
      : facet("unavailable", "No review prose or article structure was detected.");

  const citations =
    input.bibliographyDetected.detected || knowledge.citations.length > 0
      ? facet(
          "available",
          ...(input.bibliographyDetected.detected ? input.bibliographyDetected.evidence : []),
          ...(knowledge.citations.length > 0
            ? [`${knowledge.citations.length} structured citation record(s) parsed.`]
            : []),
        )
      : facet("unavailable", "No bibliography or structured citation records were detected.");

  const evidenceAvailable = knowledge.claims.length > 0 && knowledge.citations.length > 0;
  const evidenceParts =
    knowledge.claims.length > 0 ||
    knowledge.citations.length > 0 ||
    knowledge.relations.length > 0 ||
    input.provenanceDetected.detected ||
    input.manifestPresent;
  const evidencePackage = evidenceAvailable
    ? facet(
        "available",
        `${knowledge.claims.length} claim record(s) and ${knowledge.citations.length} citation record(s) form a usable evidence package.`,
        `${knowledge.relations.length} valid claim–citation relation(s) parsed.`,
      )
    : evidenceParts
      ? facet(
          "partial",
          `Evidence-package inputs are incomplete: ${knowledge.claims.length} claim(s), ${knowledge.citations.length} citation(s), and ${knowledge.relations.length} relation(s) parsed.`,
        )
      : facet("unavailable", "No evidence-package inputs were detected.");

  const graphConnected = knowledge.relations.length > 0 || validEdges > 0;
  const graphNodes = knowledge.claims.length > 0 || validNodes > 0;
  const claimGraph = graphConnected
    ? facet(
        "available",
        `${knowledge.claims.length} claim record(s), ${knowledge.relations.length} claim–citation relation(s), ${validNodes} valid node(s), and ${validEdges} valid node edge(s) parsed.`,
      )
    : graphNodes
      ? facet(
          "partial",
          `${knowledge.claims.length} claim record(s) and ${validNodes} valid node(s) parsed, but no valid relations or edges were found.`,
        )
      : facet("unavailable", "No valid claims, knowledge nodes, relations, or edges were found.");

  const assessments =
    knowledge.trust.length > 0
      ? facet("available", `${knowledge.trust.length} TRUST assessment record(s) parsed.`)
      : facet("unavailable", "No TRUST assessment records were found.");

  return { article, citations, evidencePackage, claimGraph, assessments };
}
