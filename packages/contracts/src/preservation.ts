import { z } from "zod";

/**
 * Preservation contracts: the durable per-snapshot storage payloads written at
 * submission time and the public per-version preservation manifest served by
 * the archive. Every payload is derivable from the database alone.
 */

/** Checksummed file listing stored on the repository snapshot (no content). */
export const snapshotStorageReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  githubRepositoryId: z.string().optional(),
  repositoryUrl: z.string(),
  commitSha: z.string(),
  treeSha: z.string(),
  files: z.record(
    z.string(),
    z.object({
      size: z.number().int().nonnegative(),
      truncated: z.boolean(),
      /** SHA-256 of the preserved content; null when only metadata was captured. */
      contentHash: z.string().nullable(),
    }),
  ),
});
export type SnapshotStorageReport = z.infer<typeof snapshotStorageReportSchema>;

/**
 * Durable copy of the textual file contents accepted for publication, keyed by
 * repository-relative path. Copied out of the inspection capture when the
 * submission is finalized so preservation never depends on the ephemeral
 * capability row.
 */
export const preservedFilesSchema = z.record(
  z.string(),
  z.object({
    size: z.number().int().nonnegative(),
    truncated: z.boolean(),
    content: z.string(),
  }),
);
export type PreservedFiles = z.infer<typeof preservedFilesSchema>;

export const preservedFileDescriptorSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** SHA-256 of the preserved content; absent when only metadata was captured. */
  sha256: z.string().optional(),
});
export type PreservedFileDescriptor = z.infer<typeof preservedFileDescriptorSchema>;

/** Public preservation manifest for one immutable version. */
export const preservationManifestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  review: z.object({ slug: z.string(), title: z.string() }),
  version: z.object({
    id: z.string(),
    semanticVersion: z.string().optional(),
    releaseTag: z.string().optional(),
    publishedAt: z.string().optional(),
    isExample: z.boolean(),
  }),
  repository: z.object({
    canonicalUrl: z.string(),
    githubRepositoryId: z.string().optional(),
  }),
  source: z.object({
    kind: z.string().optional(),
    branch: z.string().optional(),
    selectionKey: z.string().optional(),
    commitSha: z.string(),
    treeSha: z.string().optional(),
  }),
  licenseSpdx: z.string().optional(),
  swhids: z.object({
    revision: z.string().optional(),
    directory: z.string().optional(),
    /** Resolver URLs are only offered for real (non-example) versions. */
    archiveUrls: z.array(z.string()).optional(),
    /** Present on example versions: their object ids are synthetic. */
    note: z.string().optional(),
  }),
  integrity: z.object({
    snapshotContentHash: z.string(),
    capturePayloadHash: z.string().optional(),
  }),
  files: z.array(preservedFileDescriptorSchema),
  /** True when preserved raw file content is durably available. */
  preservedContentAvailable: z.boolean(),
});
export type PreservationManifest = z.infer<typeof preservationManifestSchema>;
