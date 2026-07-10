import { z } from "zod";
import { compatibilityLevelSchema, inspectionStatusSchema } from "./enums.js";
import { commitShaSchema } from "./identifiers.js";

/** Canonical, validated reference to a public GitHub repository. */
export const repoRefSchema = z.object({
  host: z.literal("github.com"),
  owner: z.string(),
  name: z.string(),
  canonicalUrl: z.string().url(),
});
export type RepoRef = z.infer<typeof repoRefSchema>;

export const repoFileSchema = z.object({
  /** Repository-relative path. */
  path: z.string(),
  /** Byte size reported by the tree API. */
  size: z.number().int().nonnegative(),
  /** Content included only for permitted textual files within size limits. */
  content: z.string().optional(),
  truncated: z.boolean().default(false),
});
export type RepoFile = z.infer<typeof repoFileSchema>;

export const repoReleaseSchema = z.object({
  tagName: z.string(),
  name: z.string().nullable(),
  htmlUrl: z.string().url(),
  publishedAt: z.string().nullable(),
  isDraft: z.boolean(),
  isPrerelease: z.boolean(),
  /** Zenodo DOI found in the release body, if any (not verified here). */
  bodyDois: z.array(z.string()).default([]),
});
export type RepoRelease = z.infer<typeof repoReleaseSchema>;

/**
 * Result of bounded server-side inspection of a public GitHub repository.
 * Produced by @oratlas/github; consumed by the extractor and the wizard.
 */
export const inspectionReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  repo: repoRefSchema,
  inspectedAt: z.string().datetime(),
  status: inspectionStatusSchema,
  githubRepositoryId: z.number().int().optional(),
  description: z.string().nullable().optional(),
  defaultBranch: z.string().optional(),
  latestCommitSha: commitShaSchema.optional(),
  latestCommitDate: z.string().optional(),
  licenseSpdx: z.string().nullable().optional(),
  topics: z.array(z.string()).default([]),
  homepageUrl: z.string().nullable().optional(),
  pagesUrl: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
  isFork: z.boolean().optional(),
  parentFullName: z.string().nullable().optional(),
  isTemplateInstance: z.boolean().optional(),
  templateFullName: z.string().nullable().optional(),
  starCount: z.number().int().optional(),
  createdAt: z.string().optional(),
  pushedAt: z.string().optional(),
  tags: z.array(z.object({ name: z.string(), commitSha: z.string() })).default([]),
  releases: z.array(repoReleaseSchema).default([]),
  /** Full file listing (paths + sizes) up to the traversal bound. */
  tree: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative() })).default([]),
  treeTruncated: z.boolean().default(false),
  /** Well-known files fetched with content, keyed by repository-relative path. */
  files: z.record(z.string(), repoFileSchema).default({}),
  /** Non-fatal problems (rate limits, skipped oversized files, ...). */
  warnings: z.array(z.string()).default([]),
  /** Fatal problem when status is "failed". */
  error: z.string().optional(),
  limits: z.object({
    maxFileBytes: z.number().int(),
    maxTotalBytes: z.number().int(),
    maxFileCount: z.number().int(),
    totalBytesFetched: z.number().int(),
    filesFetched: z.number().int(),
  }),
});
export type InspectionReport = z.infer<typeof inspectionReportSchema>;

/**
 * Transparent structural compatibility report (spec §7). Every signal is a
 * deterministic rule over the inspection report — never an opaque LLM verdict.
 */
export const compatibilitySignalSchema = z.object({
  detected: z.boolean(),
  /** Human-readable explanation of exactly why the signal fired or not. */
  evidence: z.array(z.string()).default([]),
});
export type CompatibilitySignal = z.infer<typeof compatibilitySignalSchema>;

export const compatibilityReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  templateForkDetected: compatibilitySignalSchema,
  templateFilesDetected: compatibilitySignalSchema,
  mystProjectDetected: compatibilitySignalSchema,
  bibliographyDetected: compatibilitySignalSchema,
  reviewContentDetected: compatibilitySignalSchema,
  provenanceDetected: compatibilitySignalSchema,
  trustDataDetected: compatibilitySignalSchema,
  releaseDetected: compatibilitySignalSchema,
  doiDetected: compatibilitySignalSchema,
  overallCompatibility: compatibilityLevelSchema,
  /** Why the repository received its level, in plain language. */
  levelRationale: z.array(z.string()),
  blockingErrors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});
export type CompatibilityReport = z.infer<typeof compatibilityReportSchema>;
