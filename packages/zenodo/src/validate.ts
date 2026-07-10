import { type DoiCheck, type DoiValidationReport } from "@oratlas/contracts";
import { isExampleDoi, isZenodoDoi, normalizeDoi, zenodoRecordIdFromDoi } from "./normalize.js";
import { createFetchResolver, type DoiResolver, type ZenodoRecord } from "./client.js";

export interface ValidateDoiInput {
  doi: string;
  /** Canonical repository URL of the submission, for cross-checking. */
  repositoryUrl?: string;
  /** Expected release tag, when a release was detected. */
  releaseTag?: string;
  /** Extracted review title, for a soft title comparison. */
  title?: string;
  /** Whether the caller expects this DOI to be a version or a concept DOI. */
  expectedKind?: "version" | "concept";
}

export interface ValidateDoiOptions {
  resolver?: DoiResolver;
  now?: () => Date;
  /** Disable outbound resolution for reserved example DOIs (always on). */
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Validate a DOI and, for Zenodo DOIs, check that its metadata plausibly
 * corresponds to the submitted repository (spec §3). Returns a structured
 * report: hard errors, soft warnings, per-check outcomes, and a confidence
 * level — never a bare boolean, and never rejecting solely for slight
 * metadata differences.
 */
export async function validateDoi(
  input: ValidateDoiInput,
  options: ValidateDoiOptions = {},
): Promise<DoiValidationReport> {
  const now = options.now ?? (() => new Date());
  const base: DoiValidationReport = {
    schemaVersion: "1.0.0",
    input: input.doi,
    status: "not-validated",
    isZenodo: false,
    doiKind: "unknown",
    recordCreators: [],
    recordRepositoryUrls: [],
    checks: [],
    errors: [],
    warnings: [],
    confidence: "none",
    validatedAt: now().toISOString(),
  };

  const norm = normalizeDoi(input.doi);
  if (!norm.ok || !norm.doi) {
    base.status = "invalid";
    base.errors.push(norm.reason ?? "Invalid DOI syntax.");
    return base;
  }
  base.normalizedDoi = norm.doi;
  base.isZenodo = isZenodoDoi(norm.doi);

  const checks: DoiCheck[] = [
    { id: "syntax", description: "DOI is syntactically valid", outcome: "pass" },
  ];

  // Reserved example DOIs never resolve outward.
  if (isExampleDoi(norm.doi)) {
    checks.push({
      id: "resolution",
      description: "DOI resolves via doi.org",
      outcome: "skipped",
      details: "Reserved example DOI (10.5555/*) — outbound resolution intentionally skipped.",
    });
    base.status = "example-not-resolvable";
    base.checks = checks;
    base.confidence = "none";
    base.warnings.push("This is a synthetic example DOI and does not resolve.");
    return base;
  }

  const resolver = options.resolver ?? createFetchResolver();

  // 1. Resolution
  const resolution = await resolver.resolveDoi(norm.doi);
  if (resolution.resolves) {
    checks.push({
      id: "resolution",
      description: "DOI resolves via doi.org",
      outcome: "pass",
      details: resolution.resolvedUrl ? `Resolves to ${resolution.resolvedUrl}` : undefined,
    });
    base.resolvedUrl = resolution.resolvedUrl;
  } else {
    checks.push({
      id: "resolution",
      description: "DOI resolves via doi.org",
      outcome: "fail",
      details: `doi.org returned status ${resolution.status}.`,
    });
    base.status = "unresolvable";
    base.errors.push("DOI does not resolve through doi.org.");
    base.checks = checks;
    return base;
  }

  // 2. Zenodo metadata comparison (only for Zenodo DOIs)
  if (base.isZenodo) {
    const recordId = zenodoRecordIdFromDoi(norm.doi);
    let record: ZenodoRecord | null = null;
    if (recordId) {
      record = await resolver.fetchZenodoRecord(recordId);
    }
    if (!record) {
      checks.push({
        id: "zenodo-metadata",
        description: "Zenodo record metadata retrieved",
        outcome: "warn",
        details: "Could not retrieve Zenodo record metadata; comparison skipped.",
      });
      base.warnings.push("Zenodo metadata could not be retrieved for comparison.");
    } else {
      applyZenodoComparison(base, checks, record, input);
    }
  } else {
    checks.push({
      id: "zenodo-metadata",
      description: "Zenodo record metadata retrieved",
      outcome: "skipped",
      details: "Not a Zenodo DOI; repository metadata comparison not applicable.",
    });
  }

  base.checks = checks;
  finalizeStatusAndConfidence(base);
  return base;
}

function applyZenodoComparison(
  report: DoiValidationReport,
  checks: DoiCheck[],
  record: ZenodoRecord,
  input: ValidateDoiInput,
): void {
  report.zenodoRecordId = record.recordId;
  report.zenodoConceptRecordId = record.conceptRecordId;
  report.recordTitle = record.title;
  report.recordCreators = record.creators;
  report.recordPublicationDate = record.publicationDate;
  report.recordVersionTag = record.versionTag;
  report.recordRepositoryUrls = record.relatedUrls;

  // Version vs concept DOI: a concept DOI's own record usually points at itself
  // as the concept; presence of a distinct conceptDoi indicates this is a
  // version DOI within a versioned deposit.
  if (record.conceptDoi && record.conceptDoi.toLowerCase() !== report.normalizedDoi) {
    report.doiKind = "version";
    report.discoveredConceptDoi = record.conceptDoi.toLowerCase();
  } else if (record.conceptDoi && record.conceptDoi.toLowerCase() === report.normalizedDoi) {
    report.doiKind = "concept";
  } else {
    report.doiKind = input.expectedKind ?? "unknown";
  }

  if (input.expectedKind && report.doiKind !== "unknown" && report.doiKind !== input.expectedKind) {
    report.warnings.push(
      `DOI appears to be a ${report.doiKind} DOI but was supplied as the ${input.expectedKind} DOI.`,
    );
  }

  // Repository URL comparison
  if (input.repositoryUrl) {
    const wanted = normalizeUrl(input.repositoryUrl);
    const found = record.relatedUrls.map(normalizeUrl);
    const matches = found.some(
      (u) => u === wanted || u.startsWith(`${wanted}/`) || u.endsWith(wanted) || wanted.endsWith(u),
    );
    checks.push({
      id: "repository-match",
      description: "Zenodo metadata references the submitted repository",
      outcome: matches ? "pass" : "warn",
      details: matches
        ? "A related identifier matches the repository URL."
        : "No related identifier matched the repository URL.",
    });
    if (!matches) {
      report.warnings.push(
        "Zenodo record does not explicitly reference the submitted repository URL.",
      );
    }
  }

  // Title comparison (soft)
  if (input.title && record.title) {
    const sim = jaccard(tokenize(input.title), tokenize(record.title));
    checks.push({
      id: "title-match",
      description: "Submitted title is similar to the Zenodo record title",
      outcome: sim >= 0.5 ? "pass" : sim >= 0.2 ? "warn" : "warn",
      details: `Token similarity ${sim.toFixed(2)}.`,
    });
    if (sim < 0.2) {
      report.warnings.push("Submitted title differs substantially from the Zenodo record title.");
    }
  }

  // Release tag comparison
  if (input.releaseTag && record.versionTag) {
    const a = input.releaseTag.replace(/^v/i, "");
    const b = record.versionTag.replace(/^v/i, "");
    const matches = a === b;
    checks.push({
      id: "release-match",
      description: "Release tag matches the Zenodo record version",
      outcome: matches ? "pass" : "warn",
      details: matches
        ? undefined
        : `Release '${input.releaseTag}' vs record '${record.versionTag}'.`,
    });
    if (!matches) {
      report.warnings.push("Release tag does not match the Zenodo record version.");
    }
  }
}

function finalizeStatusAndConfidence(report: DoiValidationReport): void {
  const passes = report.checks.filter((c) => c.outcome === "pass").length;
  const warns = report.checks.filter((c) => c.outcome === "warn").length;
  const fails = report.checks.filter((c) => c.outcome === "fail").length;

  if (fails > 0 || report.errors.length > 0) {
    report.status = "invalid";
    report.confidence = "none";
    return;
  }
  if (warns === 0) {
    report.status = "valid";
    report.confidence = passes >= 3 ? "high" : "medium";
  } else {
    report.status = "valid-with-warnings";
    report.confidence = passes > warns ? "medium" : "low";
  }
}
