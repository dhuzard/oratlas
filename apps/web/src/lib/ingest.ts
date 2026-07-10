import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@oratlas/config";
import { SynchronousIngestionRunner, parseGithubRepoUrl } from "@oratlas/github";
import { runExtraction, type FullExtraction } from "@oratlas/extractor";
import {
  resolveEffectiveMetadata,
  type CompatibilityReport,
  type EditedMetadata,
  type ExtractedMetadata,
  type InspectionReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { validateDoi } from "@oratlas/zenodo";

const env = getServerEnv();
const runner = new SynchronousIngestionRunner({ token: env.GITHUB_TOKEN || undefined });

export interface InspectionOutcome {
  report: InspectionReport;
  extraction: FullExtraction;
  extractedMetadata: ExtractedMetadata;
  compatibility: CompatibilityReport;
}

/** Inspect a repository URL and run deterministic extraction (server-side). */
export async function inspectAndExtract(url: string): Promise<InspectionOutcome> {
  const report = await runner.run(url);
  const extraction = runExtraction(report);
  return {
    report,
    extraction,
    extractedMetadata: extraction.metadata,
    compatibility: extraction.compatibility,
  };
}

export function normalizeRepoUrl(url: string) {
  return parseGithubRepoUrl(url);
}

/**
 * Build the submission validation report (spec §8) combining compatibility,
 * DOI validation, release detection and metadata completeness.
 */
export async function buildValidationReport(
  report: InspectionReport,
  compatibility: CompatibilityReport,
  extracted: ExtractedMetadata,
  edited: EditedMetadata | undefined,
  hasEvidence: boolean,
  hasTrust: boolean,
): Promise<SubmissionValidationReport> {
  const effective = resolveEffectiveMetadata(extracted, edited);

  const hardErrors: string[] = [...compatibility.blockingErrors];
  const warnings: string[] = [...compatibility.warnings];

  // DOI validation (version + concept independently). Never conflated.
  const doiValidation: SubmissionValidationReport["doiValidation"] = {};
  if (effective.versionDoi) {
    doiValidation.versionDoi = await validateDoi({
      doi: effective.versionDoi,
      repositoryUrl: effective.repositoryUrl,
      title: effective.title,
      releaseTag: effective.releaseTag,
      expectedKind: "version",
    });
  }
  if (effective.conceptDoi) {
    doiValidation.conceptDoi = await validateDoi({
      doi: effective.conceptDoi,
      repositoryUrl: effective.repositoryUrl,
      title: effective.title,
      expectedKind: "concept",
    });
  }
  for (const v of Object.values(doiValidation)) {
    if (v?.status === "invalid" || v?.status === "unresolvable") {
      warnings.push(
        `DOI ${v.input} did not validate (${v.status}); it can still be linked but is flagged.`,
      );
    }
    if (v) warnings.push(...v.warnings.map((w) => `DOI: ${w}`));
  }

  const activeRelease = report.releases.find((r) => !r.isDraft);
  const releaseValidation = {
    releaseDetected: Boolean(activeRelease),
    releaseTagMatches:
      activeRelease && effective.releaseTag
        ? activeRelease.tagName.replace(/^v/i, "") === effective.releaseTag.replace(/^v/i, "")
        : undefined,
    details: activeRelease
      ? [`Release ${activeRelease.tagName} detected.`]
      : ["No published GitHub release found; the review is eligible as repository-only."],
  };

  // Metadata completeness
  const requiredMissing: string[] = [];
  if (!effective.title) requiredMissing.push("title");
  if (!effective.repositoryUrl) requiredMissing.push("repositoryUrl");
  const recommendedMissing: string[] = [];
  for (const [key] of Object.entries({
    abstract: effective.abstract,
    authors: effective.authors.length > 0 ? "y" : undefined,
    keywords: effective.keywords.length > 0 ? "y" : undefined,
    license: effective.license,
  })) {
    const val = (effective as Record<string, unknown>)[key];
    if (!val || (Array.isArray(val) && val.length === 0)) recommendedMissing.push(key);
  }
  const completenessScore = 1 - (requiredMissing.length * 0.3 + recommendedMissing.length * 0.1);

  if (requiredMissing.length > 0) {
    hardErrors.push(`Missing required metadata: ${requiredMissing.join(", ")}.`);
  }

  return {
    schemaVersion: "1.0.0",
    hardErrors,
    warnings,
    doiValidation: doiValidation.versionDoi || doiValidation.conceptDoi ? doiValidation : undefined,
    releaseValidation,
    metadataCompleteness: {
      requiredMissing,
      recommendedMissing,
      score: Math.max(0, Math.min(1, completenessScore)),
    },
    compatibilityLevel: compatibility.overallCompatibility,
    evidenceDataAvailable: hasEvidence,
    trustDataAvailable: hasTrust,
    validatedAt: new Date().toISOString(),
  };
}

export function contentHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
