import {
  type ArtifactCompatibilityReport,
  type ArtifactOutcome,
  type ArtifactOutcomeIssue,
  type ArtifactSourceOutcome,
  type CompatibilityLevel,
  type CompatibilitySignal,
  type FacetCompatibility,
  type FacetCompatibilityReport,
  type InspectionReport,
  validateNodeManifest,
} from "@oratlas/contracts";
import { type ExtractedKnowledge, type KnowledgeArtifactOutcomes } from "./knowledge.js";
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
  knowledgeArtifactOutcomes?: KnowledgeArtifactOutcomes,
): ArtifactCompatibilityReport {
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
  const capturedReviewContent = Object.entries(report.files).some(([path, file]) => {
    const normalizedPath = path.toLowerCase();
    const isReviewContent =
      (normalizedPath.startsWith("content/") && normalizedPath.endsWith(".md")) ||
      normalizedPath.endsWith("evidence_database.md") ||
      /(^|\/)(introduction|methods|results|discussion)\.md$/.test(normalizedPath);
    return isReviewContent && !file.truncated && typeof file.content === "string";
  });

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
    capturedReviewContent,
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
    schemaVersion: "1.1.0",
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
    artifactOutcomes: {
      ...(knowledgeArtifactOutcomes ?? emptyKnowledgeArtifactOutcomes()),
      nodes: nodeArtifactOutcome(report, nodeExtraction, "nodes"),
      edges: nodeArtifactOutcome(report, nodeExtraction, "edges"),
    },
  };
}

function inspectionFailed(error: string): ArtifactCompatibilityReport {
  const empty = signal(false, []);
  const unavailable = (): ArtifactOutcome => ({
    status: "skipped",
    loadedCount: 0,
    skippedCount: null,
    sources: [],
  });
  return {
    schemaVersion: "1.1.0",
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
    artifactOutcomes: {
      claims: unavailable(),
      citations: unavailable(),
      relations: unavailable(),
      trust: unavailable(),
      nodes: unavailable(),
      edges: unavailable(),
    },
  };
}

interface FacetInputs {
  manifestPresent: boolean;
  mystProjectDetected: CompatibilitySignal;
  bibliographyDetected: CompatibilitySignal;
  reviewContentDetected: CompatibilitySignal;
  capturedReviewContent: boolean;
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

  const article = input.capturedReviewContent
    ? facet("available", ...input.reviewContentDetected.evidence)
    : input.reviewContentDetected.detected
      ? facet(
          "partial",
          "Review prose was detected in the repository tree, but no complete review prose was captured.",
        )
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

function notDeclared(): ArtifactOutcome {
  return { status: "not-declared", loadedCount: 0, skippedCount: 0, sources: [] };
}

function emptyKnowledgeArtifactOutcomes(): KnowledgeArtifactOutcomes {
  return {
    claims: notDeclared(),
    citations: notDeclared(),
    relations: notDeclared(),
    trust: notDeclared(),
  };
}

function nodeArtifactOutcome(
  report: InspectionReport,
  extraction: NodeExtractionReport | undefined,
  kind: "nodes" | "edges",
): ArtifactOutcome {
  const manifestFile = report.files["node-manifest.json"];
  const manifestInTree = report.tree.some((entry) => entry.path === "node-manifest.json");
  if (!manifestFile && !manifestInTree) return notDeclared();

  if (!extraction || extraction.manifest.status !== "ok" || manifestFile?.content === undefined) {
    const invalid = extraction?.manifest.status === "invalid";
    const issues = boundedNodeIssues(extraction, [
      {
        code: invalid ? "manifest-invalid" : "manifest-not-fetched",
        message: invalid
          ? "node-manifest.json is invalid; artifact declarations could not be processed."
          : "node-manifest.json was not fetched within the inspection budget.",
      },
    ]);
    const source: ArtifactSourceOutcome = {
      status: invalid ? "invalid" : "skipped",
      path: "node-manifest.json",
      discovery: "declared",
      loadedCount: 0,
      skippedCount: null,
      issues,
    };
    return {
      status: source.status,
      loadedCount: 0,
      skippedCount: null,
      sources: [source],
    };
  }

  let paths: string[] = [];
  try {
    const validation = validateNodeManifest(JSON.parse(manifestFile.content));
    if (!validation.ok || !validation.manifest) return invalidNodeManifestOutcome(extraction);
    const source = kind === "nodes" ? validation.manifest.nodes : validation.manifest.edges;
    if (!source) return notDeclared();
    paths = source.format === "json" ? source.files : [source.path];
  } catch {
    return invalidNodeManifestOutcome(extraction);
  }

  const records = kind === "nodes" ? extraction.nodes : extraction.edges;
  const sources = paths.map((path): ArtifactSourceOutcome => {
    const matching = records.filter((record) => record.sourcePath === path);
    const loadedCount = matching.filter((record) => record.status === "ok").length;
    const invalidCount = matching.filter((record) => record.status === "invalid").length;
    const skippedRecords = matching.filter((record) => record.status === "skipped");
    const hasUnknownSkippedCount = matching.some((record) =>
      record.issues.some((issue) =>
        ["source-not-fetched", "source-missing", "source-oversized"].includes(issue.code),
      ),
    );
    const skippedCount = hasUnknownSkippedCount
      ? null
      : invalidCount +
        skippedRecords.reduce((total, record) => total + (record.skippedRecordCount ?? 1), 0);
    const issues = matching
      .flatMap((record) => record.issues)
      .slice(0, 200)
      .map((issue) => ({ code: issue.code, message: issue.message }));
    const file = report.files[path];
    if (
      hasUnknownSkippedCount ||
      (matching.length === 0 && (!file || file.content === undefined || file.truncated))
    ) {
      return {
        status: "skipped",
        path,
        discovery: "declared",
        loadedCount: 0,
        skippedCount: null,
        issues: [
          {
            code: file?.truncated ? "source-truncated" : "source-not-fetched",
            message: `Declared ${kind} source '${path}' was unavailable for extraction.`,
          },
        ],
      };
    }
    if (loadedCount > 0 || matching.length === 0) {
      return {
        status: "loaded",
        path,
        discovery: "declared",
        loadedCount,
        skippedCount,
        issues,
      };
    }
    return {
      status: invalidCount > 0 ? "invalid" : "skipped",
      path,
      discovery: "declared",
      loadedCount: 0,
      skippedCount,
      issues:
        issues.length > 0
          ? issues
          : [{ code: "records-skipped", message: `Declared ${kind} records were skipped.` }],
    };
  });
  const status = sources.some((source) => source.status === "loaded")
    ? "loaded"
    : sources.some((source) => source.status === "invalid")
      ? "invalid"
      : "skipped";
  return {
    status,
    loadedCount: sources.reduce((total, source) => total + source.loadedCount, 0),
    skippedCount: sources.some((source) => source.skippedCount === null)
      ? null
      : sources.reduce((total, source) => total + (source.skippedCount ?? 0), 0),
    sources,
  };
}

function invalidNodeManifestOutcome(extraction: NodeExtractionReport): ArtifactOutcome {
  const issues = boundedNodeIssues(extraction, [
    { code: "manifest-invalid", message: "node-manifest.json is invalid." },
  ]);
  return {
    status: "invalid",
    loadedCount: 0,
    skippedCount: null,
    sources: [
      {
        status: "invalid",
        path: "node-manifest.json",
        discovery: "declared",
        loadedCount: 0,
        skippedCount: null,
        issues,
      },
    ],
  };
}

function boundedNodeIssues(
  extraction: NodeExtractionReport | undefined,
  fallback: ArtifactOutcomeIssue[],
): ArtifactOutcomeIssue[] {
  const issues = extraction?.errors.slice(0, 200).map((issue) => ({
    code: issue.code,
    message: issue.message,
  }));
  return issues && issues.length > 0 ? issues : fallback;
}
