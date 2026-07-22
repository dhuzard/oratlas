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

/** A caller must deliberately choose the mutable default branch or an exact tag/release. */
export const repoSourceSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default-branch") }),
  z.object({ kind: z.literal("tag"), tag: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("release"), tag: z.string().trim().min(1).max(120) }),
]);
export type RepoSourceSelection = z.infer<typeof repoSourceSelectionSchema>;

/**
 * Result of bounded server-side inspection of a public GitHub repository.
 * Produced by @oratlas/github; consumed by the extractor and the wizard.
 */
export const inspectionReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  repo: repoRefSchema,
  inspectedAt: z.string().datetime(),
  status: inspectionStatusSchema,
  /** Immutable GitHub repository database id (stored as a decimal string). */
  githubRepositoryId: z.string().regex(/^\d+$/).optional(),
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
  tags: z.array(z.object({ name: z.string(), commitSha: commitShaSchema })).default([]),
  releases: z.array(repoReleaseSchema).default([]),
  /** Exact source selected for this inspection. No implicit release guessing. */
  selectedSource: z
    .object({
      kind: z.enum(["default-branch", "tag", "release"]),
      commitSha: commitShaSchema,
      branch: z.string().optional(),
      releaseTag: z.string().optional(),
      releaseUrl: z.string().url().optional(),
      /** SHA of an annotated tag object; absent for lightweight tags. */
      tagObjectSha: commitShaSchema.optional(),
      /** Tree object belonging to commitSha; tree traversal is always pinned here. */
      treeSha: commitShaSchema,
      sourceCreatedAt: z.string().datetime().optional(),
    })
    .optional(),
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

/** Availability of one independently consumable repository capability. */
export const facetCompatibilityStatusSchema = z.enum([
  "available",
  "partial",
  "unavailable",
  "unknown",
]);
export type FacetCompatibilityStatus = z.infer<typeof facetCompatibilityStatusSchema>;

export const facetCompatibilitySchema = z
  .object({
    status: facetCompatibilityStatusSchema,
    /** Deterministic, human-readable facts supporting this facet status. */
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type FacetCompatibility = z.infer<typeof facetCompatibilitySchema>;

export const facetCompatibilityReportSchema = z
  .object({
    article: facetCompatibilitySchema,
    citations: facetCompatibilitySchema,
    evidencePackage: facetCompatibilitySchema,
    claimGraph: facetCompatibilitySchema,
    assessments: facetCompatibilitySchema,
  })
  .strict();
export type FacetCompatibilityReport = z.infer<typeof facetCompatibilityReportSchema>;

const compatibilityReportBaseShape = {
  templateForkDetected: compatibilitySignalSchema,
  templateFilesDetected: compatibilitySignalSchema,
  mystProjectDetected: compatibilitySignalSchema,
  bibliographyDetected: compatibilitySignalSchema,
  reviewContentDetected: compatibilitySignalSchema,
  provenanceDetected: compatibilitySignalSchema,
  trustDataDetected: compatibilitySignalSchema,
  releaseDetected: compatibilitySignalSchema,
  doiDetected: compatibilitySignalSchema,
  /**
   * Independently derived capability statuses. Optional only so immutable
   * reports captured before this additive field existed remain readable.
   */
  facets: facetCompatibilityReportSchema.optional(),
  overallCompatibility: compatibilityLevelSchema,
  /** Why the repository received its level, in plain language. */
  levelRationale: z.array(z.string()),
  blockingErrors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
};

export const artifactKindSchema = z.enum([
  "claims",
  "citations",
  "relations",
  "trust",
  "nodes",
  "edges",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactOutcomeIssueSchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(2_000),
    line: z.number().int().positive().optional(),
  })
  .strict();
export type ArtifactOutcomeIssue = z.infer<typeof artifactOutcomeIssueSchema>;

const artifactSourceBaseShape = {
  path: z.string().min(1).max(512),
  discovery: z.enum(["declared", "discovered"]),
  loadedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative().nullable(),
  issues: z.array(artifactOutcomeIssueSchema).max(200),
};

export const artifactSourceOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ ...artifactSourceBaseShape, status: z.literal("loaded") }).strict(),
  z
    .object({
      ...artifactSourceBaseShape,
      status: z.literal("skipped"),
      loadedCount: z.literal(0),
      issues: z.array(artifactOutcomeIssueSchema).min(1).max(200),
    })
    .strict(),
  z
    .object({
      ...artifactSourceBaseShape,
      status: z.literal("invalid"),
      loadedCount: z.literal(0),
      issues: z.array(artifactOutcomeIssueSchema).min(1).max(200),
    })
    .strict(),
]);
export type ArtifactSourceOutcome = z.infer<typeof artifactSourceOutcomeSchema>;

const artifactOutcomeBaseShape = {
  loadedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative().nullable(),
  sources: z.array(artifactSourceOutcomeSchema).max(8),
};

export const artifactOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("not-declared"),
      loadedCount: z.literal(0),
      skippedCount: z.literal(0),
      sources: z.array(artifactSourceOutcomeSchema).length(0),
    })
    .strict(),
  z.object({ ...artifactOutcomeBaseShape, status: z.literal("loaded") }).strict(),
  z.object({ ...artifactOutcomeBaseShape, status: z.literal("skipped") }).strict(),
  z.object({ ...artifactOutcomeBaseShape, status: z.literal("invalid") }).strict(),
]);
export type ArtifactOutcome = z.infer<typeof artifactOutcomeSchema>;

export const artifactOutcomesSchema = z
  .object({
    claims: artifactOutcomeSchema,
    citations: artifactOutcomeSchema,
    relations: artifactOutcomeSchema,
    trust: artifactOutcomeSchema,
    nodes: artifactOutcomeSchema,
    edges: artifactOutcomeSchema,
  })
  .strict();
export type ArtifactOutcomes = z.infer<typeof artifactOutcomesSchema>;

export const legacyCompatibilityReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  ...compatibilityReportBaseShape,
});
export type LegacyCompatibilityReport = z.infer<typeof legacyCompatibilityReportSchema>;

export const artifactCompatibilityReportSchema = z.object({
  schemaVersion: z.literal("1.1.0"),
  ...compatibilityReportBaseShape,
  artifactOutcomes: artifactOutcomesSchema,
});
export type ArtifactCompatibilityReport = z.infer<typeof artifactCompatibilityReportSchema>;

export const compatibilityReportSchema = z.discriminatedUnion("schemaVersion", [
  legacyCompatibilityReportSchema,
  artifactCompatibilityReportSchema,
]);
export type CompatibilityReport = z.infer<typeof compatibilityReportSchema>;
