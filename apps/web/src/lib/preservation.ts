import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@oratlas/config";
import {
  swhidArchiveUrl,
  swhidForDirectory,
  swhidForRevision,
  type ExportContributor,
  type PreservedFileDescriptor,
  type ProvExportInput,
  type VersionExportInput,
} from "@oratlas/exports";
import { prisma, parseJsonColumn } from "./db";
import { parseAndVerifyCapture, type InspectionCapturePayload } from "./inspection-captures";

/**
 * Preservation and export data for one immutable version, assembled from the
 * database alone. No GitHub or DOI network request occurs anywhere in this
 * module: a deleted upstream repository does not affect any output.
 */

export interface PreservationManifest {
  schemaVersion: "1.0.0";
  review: { slug: string; title: string };
  version: {
    id: string;
    semanticVersion?: string;
    releaseTag?: string;
    publishedAt?: string;
    isExample: boolean;
  };
  repository: { canonicalUrl: string; githubRepositoryId?: string };
  source: {
    kind?: string;
    branch?: string;
    selectionKey?: string;
    commitSha: string;
    treeSha?: string;
  };
  licenseSpdx?: string;
  swhids: {
    revision?: string;
    directory?: string;
    /** Resolver URLs are only offered for real (non-example) versions. */
    archiveUrls?: string[];
  };
  integrity: {
    snapshotContentHash: string;
    capturePayloadHash?: string;
  };
  files: PreservedFileDescriptor[];
  /** True when the exact accepted capture still holds full file content. */
  preservedContentAvailable: boolean;
}

export interface VersionExportContext {
  exportInput: VersionExportInput;
  provInput: ProvExportInput;
  manifest: PreservationManifest;
  capturePayload?: InspectionCapturePayload;
}

interface SnapshotStorageReport {
  schemaVersion?: string;
  files?: Record<string, { size?: number; truncated?: boolean; contentHash?: string | null }>;
}

function baseUrl(): string {
  return getServerEnv().NEXT_PUBLIC_BASE_URL.replace(/\/+$/, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function loadVersionRow(slug: string, versionId: string) {
  const review = await prisma.review.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (!review) return null;
  const version = await prisma.reviewVersion.findFirst({
    where: { id: versionId, reviewId: review.id },
    include: {
      snapshot: { include: { repository: true } },
      contributors: { include: { person: true }, orderBy: { position: "asc" } },
      inspectionCapture: true,
      sourceSubmission: {
        include: { submitter: true, reviewer: true },
      },
    },
  });
  if (!version) return null;
  return { review, version };
}

export async function getVersionExportContext(
  slug: string,
  versionId: string,
): Promise<VersionExportContext | null> {
  const loaded = await loadVersionRow(slug, versionId);
  if (!loaded) return null;
  const { review, version } = loaded;
  const snapshot = version.snapshot;
  const repository = snapshot.repository;

  let capturePayload: InspectionCapturePayload | undefined;
  if (version.inspectionCapture) {
    try {
      capturePayload = parseAndVerifyCapture(
        version.inspectionCapture.payloadJson,
        version.inspectionCapture.payloadHash,
      );
    } catch {
      // A capture that fails its integrity check is treated as absent; the
      // metadata-only preservation path below still works.
      capturePayload = undefined;
    }
  }

  const meta = parseJsonColumn<{ keywords?: string[]; domains?: string[]; license?: string }>(
    version.metadataJson,
    {},
  );
  const canonicalUrl = `${baseUrl()}/reviews/${review.slug}/versions/${version.id}`;
  const contributors: ExportContributor[] = version.contributors.map((contributor) => ({
    displayName: contributor.person.displayName,
    givenName: contributor.person.givenName ?? undefined,
    familyName: contributor.person.familyName ?? undefined,
    orcid: contributor.person.orcid ?? undefined,
  }));

  const exportInput: VersionExportInput = {
    slug: review.slug,
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
    canonicalUrl,
    versionId: version.id,
    title: version.title,
    repositoryUrl: repository.canonicalUrl,
    commitSha: snapshot.commitSha,
    treeSha: snapshot.sourceTreeSha ?? undefined,
    capture: version.inspectionCapture
      ? {
          payloadHash: version.inspectionCapture.payloadHash,
          capturedAt: version.inspectionCapture.createdAt.toISOString(),
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
      editorLogin: version.sourceSubmission?.reviewer?.githubLogin,
    },
  };

  const files = preservedFiles(snapshot.inspectionReportJson, capturePayload);
  const revision = swhidForRevision(snapshot.commitSha);
  const directory = snapshot.sourceTreeSha ? swhidForDirectory(snapshot.sourceTreeSha) : undefined;
  const archiveUrls = version.isExample
    ? undefined
    : [revision, directory].filter((value): value is string => Boolean(value)).map(swhidArchiveUrl);

  const manifest: PreservationManifest = {
    schemaVersion: "1.0.0",
    review: { slug: review.slug, title: version.title },
    version: {
      id: version.id,
      semanticVersion: version.semanticVersion ?? undefined,
      releaseTag: version.releaseTag ?? undefined,
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
      ...(archiveUrls && archiveUrls.length > 0 ? { archiveUrls } : {}),
    },
    integrity: {
      snapshotContentHash: snapshot.contentHash,
      capturePayloadHash: version.capturePayloadHash ?? undefined,
    },
    files,
    preservedContentAvailable: Boolean(capturePayload),
  };

  return { exportInput, provInput, manifest, capturePayload };
}

/**
 * File descriptors for the preserved package. The snapshot's storage report
 * (written at submission) is authoritative for checksums; a verified capture
 * is used as fallback for hashes and is the only source of raw content.
 */
function preservedFiles(
  inspectionReportJson: string,
  capturePayload?: InspectionCapturePayload,
): PreservedFileDescriptor[] {
  const report = parseJsonColumn<SnapshotStorageReport>(inspectionReportJson, {});
  const out = new Map<string, PreservedFileDescriptor>();
  if (report.files) {
    for (const [path, file] of Object.entries(report.files)) {
      out.set(path, {
        path,
        size: typeof file.size === "number" ? file.size : 0,
        truncated: file.truncated === true,
        sha256: file.contentHash ?? undefined,
      });
    }
  }
  if (capturePayload) {
    for (const [path, file] of Object.entries(capturePayload.report.files)) {
      if (out.has(path)) continue;
      out.set(path, {
        path,
        size: file.size,
        truncated: file.truncated,
        sha256: file.content !== undefined ? sha256(file.content) : undefined,
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
 * Preserved raw content of one captured file. Only files whose textual
 * content was included in the exact accepted capture are servable.
 */
export async function getPreservedFileContent(
  slug: string,
  versionId: string,
  path: string,
): Promise<PreservedFileContent | null> {
  const context = await getVersionExportContext(slug, versionId);
  if (!context?.capturePayload) return null;
  const file = context.capturePayload.report.files[path];
  if (!file || file.content === undefined) return null;
  return { path, size: file.size, truncated: file.truncated, content: file.content };
}
