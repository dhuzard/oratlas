import "server-only";
import { z } from "zod";
import {
  preservationManifestSchema,
  preservedFilesSchema,
  conflictOfInterestStatusSchema,
  snapshotStorageReportSchema,
  isExactCommitSha,
  isSafeRepoRelativePath,
  sourceAssessmentDocumentsReportSchema,
  type PreservationManifest,
  type PreservedFileDescriptor,
  type PreservedFiles,
} from "@oratlas/contracts";
import { PLATFORM_VERSION } from "@oratlas/config";
import {
  swhidArchiveUrl,
  swhidForDirectory,
  swhidForRevision,
  type ExportContributor,
  type ProvExportInput,
  type ScholarlyJsonInput,
  type VersionExportInput,
} from "@oratlas/exports";
import { appBaseUrl } from "./base-url";
import { listChallenges } from "./challenges";
import { prisma, parseJsonColumn } from "./db";
import { sha256 } from "./hash";
import { toTrustRecordForExport } from "./index-builder";
import { resolveTrustAssessmentRows } from "./trust-provenance";

/**
 * Preservation and export data for one immutable version, assembled from the
 * database alone. No GitHub or DOI network request occurs anywhere in this
 * module: a deleted upstream repository does not affect any output.
 *
 * Preserved file content lives durably on the repository snapshot
 * (preservedFilesJson, written at submission). The inspection capture is an
 * expiring capability and is never consulted by public delivery paths.
 */

export const EXAMPLE_SWHID_NOTE =
  "Synthetic example object ids; these SWHIDs are not present in any archive.";

export interface VersionExportContext {
  exportInput: VersionExportInput;
  provInput: ProvExportInput;
  manifest: PreservationManifest;
  scholarlyInput: ScholarlyJsonInput;
}

const exportLimitationsSchema = z.array(z.string().max(2_000)).max(50);
const exportEvidenceSchema = z.record(z.string(), z.unknown());
const exportMetadataSchema = z.record(z.string(), z.unknown());

function parsePersistedExportJson<T>(label: string, value: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid persisted ${label} JSON.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid persisted ${label} JSON.`);
  return result.data;
}

function parsePersistedConflictOfInterest(value: string) {
  const parsed = conflictOfInterestStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid persisted TRUST conflict-of-interest status.");
  }
  return parsed.data;
}

async function loadVersionRow(slug: string, versionId: string) {
  return prisma.reviewVersion.findFirst({
    // Exports are public artifacts of the public archive: only versions of
    // published reviews are served, matching the Atom feed.
    where: {
      id: versionId,
      publicState: { in: ["published", "withdrawn"] },
      review: { slug, status: "published" },
    },
    include: {
      review: { select: { slug: true } },
      snapshot: { include: { repository: true } },
      contributors: { include: { person: true }, orderBy: { position: "asc" } },
      sourceSubmission: {
        include: {
          submitter: true,
          reviewer: true,
          decisionProvenance: true,
          reviewRounds: {
            orderBy: { roundNumber: "desc" },
            select: {
              decisionLetter: {
                select: { decision: true, editorGithubLoginSnapshot: true },
              },
            },
          },
        },
      },
    },
  });
}

type VersionRow = NonNullable<Awaited<ReturnType<typeof loadVersionRow>>>;

export async function getVersionExportContext(
  slug: string,
  versionId: string,
): Promise<VersionExportContext | null> {
  const version = await loadVersionRow(slug, versionId);
  if (!version || !version.snapshot || !isExactCommitSha(version.snapshot.commitSha)) return null;
  const snapshot = version.snapshot;
  const repository = snapshot.repository;

  const meta = parseJsonColumn<{ keywords?: string[]; domains?: string[]; license?: string }>(
    version.metadataJson,
    {},
  );
  const canonicalUrl = `${appBaseUrl()}/reviews/${version.review.slug}/versions/${version.id}`;
  const contributors: ExportContributor[] = version.contributors.map((contributor) => ({
    displayName: contributor.person.displayName,
    givenName: contributor.person.givenName ?? undefined,
    familyName: contributor.person.familyName ?? undefined,
    orcid: contributor.person.orcid ?? undefined,
  }));
  const acceptanceEditorLogin =
    version.sourceSubmission?.decisionProvenance?.actorGithubLoginSnapshot ??
    version.sourceSubmission?.reviewRounds.find(
      (round) => round.decisionLetter?.decision === "accept",
    )?.decisionLetter?.editorGithubLoginSnapshot ??
    undefined;

  const exportInput: VersionExportInput = {
    platformVersion: PLATFORM_VERSION,
    slug: version.review.slug,
    versionId: version.id,
    title: version.title,
    abstract: version.abstract ?? undefined,
    contributors,
    keywords: meta.keywords ?? [],
    domains: meta.domains ?? [],
    licenseSpdx: meta.license ?? repository.licenseSpdx ?? undefined,
    publishedAt: version.publishedAt?.toISOString(),
    semanticVersion: version.semanticVersion ?? undefined,
    releaseTag: version.releaseTag ?? snapshot.releaseTag ?? undefined,
    releaseUrl: version.releaseUrl ?? snapshot.releaseUrl ?? undefined,
    versionDoi: version.versionDoi ?? undefined,
    conceptDoi: version.conceptDoi ?? undefined,
    zenodoRecordId: version.zenodoRecordId ?? undefined,
    isExample: version.isExample,
    repositoryUrl: repository.canonicalUrl,
    commitSha: snapshot.commitSha,
    treeSha: snapshot.sourceTreeSha ?? undefined,
    canonicalUrl,
  };

  const provInput: ProvExportInput = {
    platformVersion: PLATFORM_VERSION,
    canonicalUrl,
    versionId: version.id,
    title: version.title,
    repositoryUrl: repository.canonicalUrl,
    commitSha: snapshot.commitSha,
    treeSha: snapshot.sourceTreeSha ?? undefined,
    capture: version.capturePayloadHash
      ? {
          payloadHash: version.capturePayloadHash,
          capturedAt: snapshot.capturedAt.toISOString(),
        }
      : undefined,
    submission: version.sourceSubmission
      ? {
          id: version.sourceSubmission.id,
          submittedAt: version.sourceSubmission.submittedAt?.toISOString(),
          submitterLogin: version.sourceSubmission.submitter.githubLogin,
        }
      : undefined,
    acceptance: {
      publishedAt: version.publishedAt?.toISOString(),
      editorLogin: acceptanceEditorLogin,
    },
  };

  const preserved = preservedFilesForVersion(version);
  // Public preservation/export delivery never falls back to the expiring
  // inspection capability. Legacy missing or malformed durable storage is
  // unavailable until explicitly migrated.
  if (!preserved) return null;
  const files = fileDescriptors(version, preserved);
  const revision = swhidForRevision(snapshot.commitSha);
  const directory = snapshot.sourceTreeSha ? swhidForDirectory(snapshot.sourceTreeSha) : undefined;
  const archiveUrls = version.isExample
    ? undefined
    : [revision, directory].filter((value): value is string => Boolean(value)).map(swhidArchiveUrl);

  const manifest: PreservationManifest = preservationManifestSchema.parse({
    schemaVersion: "1.0.0",
    platformVersion: PLATFORM_VERSION,
    review: { slug: version.review.slug, title: version.title },
    version: {
      id: version.id,
      semanticVersion: version.semanticVersion ?? undefined,
      releaseTag: exportInput.releaseTag,
      publishedAt: version.publishedAt?.toISOString(),
      isExample: version.isExample,
    },
    repository: {
      canonicalUrl: repository.canonicalUrl,
      githubRepositoryId: repository.githubRepositoryId ?? undefined,
    },
    source: {
      kind: version.sourceKind ?? snapshot.sourceKind ?? undefined,
      branch: version.sourceBranch ?? snapshot.branch ?? undefined,
      selectionKey: version.sourceSelectionKey ?? undefined,
      commitSha: snapshot.commitSha,
      treeSha: snapshot.sourceTreeSha ?? undefined,
    },
    licenseSpdx: exportInput.licenseSpdx,
    swhids: {
      revision,
      directory,
      archiveUrls: archiveUrls && archiveUrls.length > 0 ? archiveUrls : undefined,
      note: version.isExample && (revision || directory) ? EXAMPLE_SWHID_NOTE : undefined,
    },
    integrity: {
      snapshotContentHash: snapshot.contentHash,
      capturePayloadHash: version.capturePayloadHash ?? undefined,
    },
    files,
    preservedContentAvailable: true,
  } satisfies PreservationManifest);

  const [assessmentRows, challengeList] = await Promise.all([
    prisma.trustAssessment.findMany({
      where: {
        relation: {
          claim: { reviewVersionId: version.id },
          citation: { reviewVersionId: version.id },
        },
      },
      include: {
        verification: { include: { reviewer: { select: { githubLogin: true } } } },
        relation: { include: { claim: true, citation: true } },
      },
      orderBy: [{ id: "asc" }],
    }),
    listChallenges(version.review.slug, version.id),
  ]);
  const persistedMetadata = parsePersistedExportJson(
    "review metadata",
    version.metadataJson,
    exportMetadataSchema,
  );
  const sourceDocuments =
    persistedMetadata.sourceAssessmentDocuments === undefined
      ? undefined
      : sourceAssessmentDocumentsReportSchema.parse(persistedMetadata.sourceAssessmentDocuments);
  const scholarlyInput: ScholarlyJsonInput = {
    version: exportInput,
    assessments: assessmentRows.map((assessment) => {
      const resolved = resolveTrustAssessmentRows(
        {
          assessment,
          relation: assessment.relation,
          claim: assessment.relation.claim,
          citation: assessment.relation.citation,
        },
        assessment.verification,
      );
      const record = toTrustRecordForExport(assessment);
      return {
        id: assessment.id,
        url: `${canonicalUrl}#assessment-${encodeURIComponent(assessment.id)}`,
        relation: {
          id: assessment.relation.id,
          claim: {
            localId: assessment.relation.claim.localClaimId,
            url: `${canonicalUrl}#claim-subject-${encodeURIComponent(assessment.relation.claim.id)}`,
          },
          citation: {
            localId: assessment.relation.citation.localCitationId,
            title: assessment.relation.citation.title ?? undefined,
          },
          relationType: assessment.relation.relationType,
        },
        protocolVersion: assessment.protocolVersion,
        assessor: {
          type: assessment.assessorType,
          identifier: assessment.assessorId ?? undefined,
        },
        assessedAt: assessment.assessedAt?.toISOString(),
        conflictOfInterest: {
          status: parsePersistedConflictOfInterest(assessment.conflictOfInterestStatus),
        },
        criteria: record.criteria,
        limitations: parsePersistedExportJson(
          `TRUST limitations for assessment ${assessment.id}`,
          assessment.limitationsJson,
          exportLimitationsSchema,
        ),
        evidence: assessment.evidenceJson
          ? parsePersistedExportJson(
              `TRUST evidence for assessment ${assessment.id}`,
              assessment.evidenceJson,
              exportEvidenceSchema,
            )
          : undefined,
        verification: {
          state: resolved.state,
          effectiveReviewStatus: resolved.effectiveStatus,
          sourceAssertion: assessment.sourceRecordJson
            ? {
                reviewStatus: assessment.sourceReviewStatus ?? undefined,
                assessorType: assessment.sourceAssessorType ?? undefined,
                assessorId: assessment.sourceAssessorId ?? undefined,
                assessedAt: assessment.sourceAssessedAt?.toISOString(),
                relationHumanReviewed: assessment.sourceRelationHumanReviewed ?? undefined,
              }
            : undefined,
          platformAssertion:
            resolved.state === "platform-verified" && assessment.verification
              ? {
                  status: assessment.verification.status,
                  reviewerLogin: assessment.verification.reviewer.githubLogin,
                  reviewedAt: assessment.verification.updatedAt.toISOString(),
                }
              : undefined,
        },
        supersedesAssessmentId: assessment.supersedesAssessmentId ?? undefined,
      };
    }),
    challenges: challengeList?.challenges ?? [],
    sourceDocuments: sourceDocuments
      ? sourceDocuments.documents.map((document) => ({
          ...document,
          downloadUrl:
            document.status === "preserved"
              ? `${appBaseUrl()}/api/reviews/${encodeURIComponent(version.review.slug)}/versions/${encodeURIComponent(version.id)}/files/${encodeURIComponent(document.path)}`
              : undefined,
        }))
      : [],
  };

  return { exportInput, provInput, manifest, scholarlyInput };
}

/**
 * Durable preserved content for a version. InspectionCapture is an expiring
 * submission capability and is never a public delivery fallback.
 */
function preservedFilesForVersion(version: VersionRow): PreservedFiles | null {
  if (!version.snapshot) return null;
  if (!version.snapshot.preservedFilesJson) return null;
  const parsed = preservedFilesSchema.safeParse(
    parseJsonColumn<unknown>(version.snapshot.preservedFilesJson, null),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * File descriptors for the preserved package. The snapshot's storage report
 * (written at submission) is authoritative for checksums; preserved content
 * fills hashes for legacy rows whose report predates checksum storage.
 */
function fileDescriptors(
  version: VersionRow,
  preserved: PreservedFiles | null,
): PreservedFileDescriptor[] {
  if (!version.snapshot) return [];
  const out = new Map<string, PreservedFileDescriptor>();
  const report = snapshotStorageReportSchema.safeParse(
    parseJsonColumn<unknown>(version.snapshot.inspectionReportJson, null),
  );
  if (report.success) {
    for (const [path, file] of Object.entries(report.data.files)) {
      out.set(path, {
        path,
        size: file.size,
        truncated: file.truncated,
        sha256: file.contentHash ?? undefined,
      });
    }
  }
  if (preserved) {
    for (const [path, file] of Object.entries(preserved)) {
      if (out.has(path)) continue;
      out.set(path, {
        path,
        size: file.size,
        truncated: file.truncated,
        sha256: sha256(file.content),
      });
    }
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export interface PreservedFileContent {
  path: string;
  size: number;
  truncated: boolean;
  content: string;
}

/**
 * Preserved raw content of one file. Reads only the columns it needs; the
 * full export context is not assembled for file downloads.
 */
export async function getPreservedFileContent(
  slug: string,
  versionId: string,
  path: string,
): Promise<PreservedFileContent | null> {
  if (!isSafeRepoRelativePath(path)) return null;
  const version = await prisma.reviewVersion.findFirst({
    where: {
      id: versionId,
      publicState: { in: ["published", "withdrawn"] },
      review: { slug, status: "published" },
    },
    select: {
      snapshot: { select: { commitSha: true, preservedFilesJson: true } },
    },
  });
  if (!version || !version.snapshot || !isExactCommitSha(version.snapshot.commitSha)) return null;

  if (version.snapshot.preservedFilesJson) {
    const parsed = preservedFilesSchema.safeParse(
      parseJsonColumn<unknown>(version.snapshot.preservedFilesJson, null),
    );
    const file = parsed.success ? parsed.data[path] : undefined;
    if (file) return { path, size: file.size, truncated: file.truncated, content: file.content };
    if (parsed.success) return null;
  }
  return null;
}
