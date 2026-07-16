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
  type RepoSourceSelection,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { validateDoi } from "@oratlas/zenodo";
import { buildPublicationConsistency } from "./publication-consistency";

const env = getServerEnv();
const runner = new SynchronousIngestionRunner({ token: env.GITHUB_TOKEN || undefined });

export interface InspectionOutcome {
  report: InspectionReport;
  extraction: FullExtraction;
  extractedMetadata: ExtractedMetadata;
  compatibility: CompatibilityReport;
}

/** Inspect a repository URL and run deterministic extraction (server-side). */
export async function inspectAndExtract(
  url: string,
  source: RepoSourceSelection = { kind: "default-branch" },
): Promise<InspectionOutcome> {
  const report = await runner.run(url, { source });
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
  hasPublishableNodes = false,
): Promise<SubmissionValidationReport> {
  const effective = resolveEffectiveMetadata(extracted, edited);

  const hardErrors: string[] = [...compatibility.blockingErrors];
  const warnings: string[] = [...compatibility.warnings];

  // DOI validation (version + concept independently). Never conflated.
  const doiValidation: SubmissionValidationReport["doiValidation"] = {};
  if (effective.versionDoi) {
    doiValidation.versionDoi = await validateDoi({
      doi: effective.versionDoi,
      repositoryUrl: report.repo.canonicalUrl,
      title: effective.title,
      releaseTag: effective.releaseTag,
      expectedKind: "version",
    });
  }
  if (effective.conceptDoi) {
    doiValidation.conceptDoi = await validateDoi({
      doi: effective.conceptDoi,
      repositoryUrl: report.repo.canonicalUrl,
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

  const publicationConsistency = report.selectedSource
    ? buildPublicationConsistency(report, effective, doiValidation)
    : undefined;
  if (publicationConsistency) warnings.push(...publicationConsistency.warnings);

  const selected = report.selectedSource;
  const activeRelease =
    selected?.kind === "release"
      ? report.releases.find(
          (release) => release.tagName === selected.releaseTag && !release.isDraft,
        )
      : undefined;
  const releaseValidation = {
    releaseDetected: Boolean(activeRelease),
    releaseTagMatches:
      selected?.releaseTag && effective.releaseTag
        ? selected.releaseTag.replace(/^v/i, "") === effective.releaseTag.replace(/^v/i, "")
        : undefined,
    details:
      selected?.kind === "release"
        ? [`Published release ${selected.releaseTag} explicitly selected.`]
        : selected?.kind === "tag"
          ? [`Non-release Git tag ${selected.releaseTag} explicitly selected.`]
          : ["Default branch explicitly selected; the review is eligible as repository-only."],
  };

  // Metadata completeness
  const requiredMissing: string[] = [];
  if (!effective.title && !hasPublishableNodes) requiredMissing.push("title");
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
    publicationConsistency,
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
