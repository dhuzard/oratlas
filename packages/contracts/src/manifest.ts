import { z } from "zod";
import {
  commitShaSchema,
  doiSchema,
  httpsUrlSchema,
  orcidSchema,
  zenodoRecordIdSchema,
} from "./identifiers.js";
import { reviewTypeSchema } from "./enums.js";
import { safeRepoRelativePathSchema } from "./paths.js";

/**
 * Review manifest contract, version 1.0.0.
 *
 * Compatible review repositories may include a `review-manifest.json` at the
 * repository root. The manifest is the highest-priority deterministic
 * extraction source, but it is always optional: the platform still extracts
 * metadata from CITATION.cff, .zenodo.json, codemeta.json, MyST configuration,
 * repository metadata and README when it is absent.
 *
 * The matching JSON Schema lives at `schemas/review-manifest.schema.json`.
 */
export const REVIEW_MANIFEST_SCHEMA_VERSION = "1.0.0";

export const manifestContributorSchema = z
  .object({
    displayName: z.string().min(1).max(300),
    givenName: z.string().max(150).optional(),
    familyName: z.string().max(150).optional(),
    orcid: orcidSchema.optional(),
    githubLogin: z.string().max(39).optional(),
    roles: z.array(z.string().max(80)).max(20).optional(),
  })
  .strict();

export const manifestArtifactsSchema = z
  .object({
    claims: safeRepoRelativePathSchema.optional(),
    citations: safeRepoRelativePathSchema.optional(),
    relations: safeRepoRelativePathSchema.optional(),
    trustAssessments: safeRepoRelativePathSchema.optional(),
    provenance: safeRepoRelativePathSchema.optional(),
  })
  .strict();

export const reviewManifestSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_MANIFEST_SCHEMA_VERSION),
    review: z
      .object({
        title: z.string().min(1).max(500),
        abstract: z.string().max(10_000).optional(),
        reviewType: reviewTypeSchema.optional(),
        language: z
          .string()
          .regex(/^[a-z]{2}(-[A-Za-z]{2,8})?$/)
          .optional(),
        keywords: z.array(z.string().min(1).max(100)).max(50).optional(),
        domains: z.array(z.string().min(1).max(100)).max(20).optional(),
        license: z.string().max(120).optional(),
      })
      .strict(),
    repository: z
      .object({
        url: httpsUrlSchema,
        commit: commitShaSchema.optional(),
        releaseTag: z.string().max(120).optional(),
      })
      .strict(),
    publication: z
      .object({
        reviewUrl: httpsUrlSchema.optional(),
        versionDoi: doiSchema.optional(),
        conceptDoi: doiSchema.optional(),
        zenodoRecordId: zenodoRecordIdSchema.optional(),
      })
      .strict()
      .optional(),
    contact: z
      .object({
        name: z.string().max(300).optional(),
        orcid: orcidSchema.optional(),
        url: httpsUrlSchema.optional(),
      })
      .strict()
      .optional(),
    contributors: z.array(manifestContributorSchema).max(200).optional(),
    artifacts: manifestArtifactsSchema.optional(),
  })
  .strict();

export type ReviewManifest = z.infer<typeof reviewManifestSchema>;
export type ManifestContributor = z.infer<typeof manifestContributorSchema>;

export interface ManifestValidationResult {
  ok: boolean;
  manifest?: ReviewManifest;
  errors: string[];
}

/** Validate a parsed JSON value as a review manifest, returning readable errors. */
export function validateReviewManifest(value: unknown): ManifestValidationResult {
  const parsed = reviewManifestSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, manifest: parsed.data, errors: [] };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
