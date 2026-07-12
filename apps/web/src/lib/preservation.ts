import "server-only";
import {
  preservationManifestSchema,
  preservedFilesSchema,
  snapshotStorageReportSchema,
  type PreservationManifest,
  type PreservedFileDescriptor,
  type PreservedFiles,
} from "@oratlas/contracts";
import {
  swhidArchiveUrl,
  swhidForDirectory,
  swhidForRevision,
  type ExportContributor,
  type ProvExportInput,
  type VersionExportInput,
} from "@oratlas/exports";
import { appBaseUrl } from "./base-url";
import { prisma, parseJsonColumn } from "./db";
import { sha256 } from "./hash";
import { parseAndVerifyCapture } from "./inspection-captures";

/**
 * Preservation and export data for one immutable version, assembled from the
 * database alone. No GitHub or DOI network request occurs anywhere in this
 * module: a deleted upstream repository does not affect any output.
 *
 * Preserved file content lives durably on the repository snapshot
 * (preservedFilesJson, written at submission). The inspection capture is only
 * consulted as a fallback for rows created before that column existed.
 */

export const EXAMPLE_SWHID_NOTE =
  "Synthetic example object ids; these SWHIDs are not present in any archive.";

export interface VersionExportContext {
  exportInput: VersionExportInput;
  provInput: ProvExportInput;
  manifest: PreservationManifest;
}

async function loadVersionRow(slug: string, versionId: string) {
  return prisma.reviewVersion.findFirst({
    // Exports are public artifacts of the public archive: only versions of
    // published reviews are served, matching the Atom feed.
    where: { id: versionId, review: { slug, status: "published" } },
    include: {
      review: { select: { slug: true } },
      snapshot: { include: { repository: true } },
      contributors: { include: { person: true }, orderBy: { position: "asc" } },
      inspectionCapture: true,
      sourceSubmission: { include: { submitter: true, reviewer: true } },
    },
  });
}

type VersionRow = NonNullable<Awaited<ReturnType<typeof loadVersionRow>>>;

export async function getVersionExportContext(
  slug: string,
  versionId: string,
): Promise<VersionExportContext | null> {
  const version = await loadVersionRow(slug, versionId);
  if (!version) return null;
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

  const exportInput: VersionExportInput = {
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

  const preserved = preservedFilesForVersion(version);
  const files = fileDescriptors(version, preserved);
  const revision = swhidForRevision(snapshot.commitSha);
  const directory = snapshot.sourceTreeSha ? swhidForDirectory(snapshot.sourceTreeSha) : undefined;
  const archiveUrls = version.isExample
    ? undefined
    : [revision, directory].filter((value): value is string => Boolean(value)).map(swhidArchiveUrl);

  const manifest: PreservationManifest = preservationManifestSchema.parse({
    schemaVersion: "1.0.0",
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
      capturePayloadHash:
        version.capturePayloadHash ?? version.inspectionCapture?.payloadHash ?? undefined,
    },
    files,
    preservedContentAvailable: preserved !== null,
  } satisfies PreservationManifest);

  return { exportInput, provInput, manifest };
}

/**
 * Durable preserved content for a version: the snapshot column first, then
 * the verified inspection capture for legacy rows. Null when neither holds
 * raw content (metadata-only preservation).
 */
function preservedFilesForVersion(version: VersionRow): PreservedFiles | null {
  if (version.snapshot.preservedFilesJson) {
    const parsed = preservedFilesSchema.safeParse(
      parseJsonColumn<unknown>(version.snapshot.preservedFilesJson, null),
    );
    if (parsed.success) return parsed.data;
  }
  if (version.inspectionCapture) {
    try {
      const payload = parseAndVerifyCapture(
        version.inspectionCapture.payloadJson,
        version.inspectionCapture.payloadHash,
      );
      const out: PreservedFiles = {};
      for (const [path, file] of Object.entries(payload.report.files)) {
        if (file.content === undefined) continue;
        out[path] = { size: file.size, truncated: file.truncated, content: file.content };
      }
      return out;
    } catch {
      // A capture that fails its integrity check contributes nothing.
    }
  }
  return null;
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
  const version = await prisma.reviewVersion.findFirst({
    where: { id: versionId, review: { slug, status: "published" } },
    select: {
      snapshot: { select: { preservedFilesJson: true } },
      inspectionCapture: { select: { payloadJson: true, payloadHash: true } },
    },
  });
  if (!version) return null;

  if (version.snapshot.preservedFilesJson) {
    const parsed = preservedFilesSchema.safeParse(
      parseJsonColumn<unknown>(version.snapshot.preservedFilesJson, null),
    );
    const file = parsed.success ? parsed.data[path] : undefined;
    if (file) return { path, size: file.size, truncated: file.truncated, content: file.content };
    if (parsed.success) return null;
  }
  if (version.inspectionCapture) {
    try {
      const payload = parseAndVerifyCapture(
        version.inspectionCapture.payloadJson,
        version.inspectionCapture.payloadHash,
      );
      const file = payload.report.files[path];
      if (file?.content !== undefined) {
        return { path, size: file.size, truncated: file.truncated, content: file.content };
      }
    } catch {
      // Fall through: integrity-failed captures serve nothing.
    }
  }
  return null;
}
