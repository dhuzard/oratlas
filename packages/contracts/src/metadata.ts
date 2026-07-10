import { z } from "zod";
import { extractionSourceSchema, reviewTypeSchema } from "./enums.js";
import {
  commitShaSchema,
  doiSchema,
  httpsUrlSchema,
  orcidSchema,
  zenodoRecordIdSchema,
} from "./identifiers.js";

/**
 * Field-level provenance: where an extracted value came from.
 * Every extracted metadata value carries one of these; manual edits are stored
 * separately and never overwrite the extracted value.
 */
export const fieldProvenanceSchema = z.object({
  source: extractionSourceSchema,
  /** Repository-relative source file, when applicable (e.g. "CITATION.cff"). */
  file: z.string().max(512).optional(),
  /** JSON/YAML pointer-ish path inside the source file (e.g. "review.title"). */
  pointer: z.string().max(512).optional(),
  commitSha: commitShaSchema.optional(),
  extractorVersion: z.string().max(40),
  extractedAt: z.string().datetime(),
  /** Deterministic confidence in [0,1]; heuristics score lower than manifests. */
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(500)).default([]),
});
export type FieldProvenance = z.infer<typeof fieldProvenanceSchema>;

export function extractedFieldSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, provenance: fieldProvenanceSchema });
}

export const editedFieldMetaSchema = z.object({
  editorGithubLogin: z.string().max(100).optional(),
  editorUserId: z.string().max(100).optional(),
  editedAt: z.string().datetime(),
});
export type EditedFieldMeta = z.infer<typeof editedFieldMetaSchema>;

const str = z.string().max(10_000);

export const extractedPersonSchema = z.object({
  displayName: z.string().min(1).max(300),
  givenName: z.string().max(150).optional(),
  familyName: z.string().max(150).optional(),
  orcid: orcidSchema.optional(),
  githubLogin: z.string().max(39).optional(),
  roles: z.array(z.string().max(80)).default([]),
});
export type ExtractedPerson = z.infer<typeof extractedPersonSchema>;

/**
 * The full extracted-metadata document produced by @oratlas/extractor.
 * Every field is optional (extraction is best-effort) and carries provenance.
 */
export const extractedMetadataSchema = z.object({
  extractorVersion: z.string(),
  extractedAt: z.string().datetime(),
  commitSha: commitShaSchema.optional(),
  fields: z.object({
    title: extractedFieldSchema(z.string().max(500)).optional(),
    abstract: extractedFieldSchema(str).optional(),
    authors: extractedFieldSchema(z.array(extractedPersonSchema)).optional(),
    keywords: extractedFieldSchema(z.array(z.string().max(100))).optional(),
    domains: extractedFieldSchema(z.array(z.string().max(100))).optional(),
    reviewType: extractedFieldSchema(reviewTypeSchema).optional(),
    license: extractedFieldSchema(z.string().max(120)).optional(),
    repositoryUrl: extractedFieldSchema(httpsUrlSchema).optional(),
    publishedReviewUrl: extractedFieldSchema(httpsUrlSchema).optional(),
    commitSha: extractedFieldSchema(commitShaSchema).optional(),
    releaseTag: extractedFieldSchema(z.string().max(120)).optional(),
    versionDoi: extractedFieldSchema(doiSchema).optional(),
    conceptDoi: extractedFieldSchema(doiSchema).optional(),
    zenodoRecordId: extractedFieldSchema(zenodoRecordIdSchema).optional(),
    contact: extractedFieldSchema(z.string().max(300)).optional(),
    language: extractedFieldSchema(z.string().max(20)).optional(),
  }),
  warnings: z.array(z.string().max(1000)).default([]),
});
export type ExtractedMetadata = z.infer<typeof extractedMetadataSchema>;

/**
 * Manual corrections captured in the submission wizard. Only fields the
 * submitter actually changed appear here; each edit records who and when.
 * The extracted value is preserved unmodified alongside.
 */
export const editedMetadataSchema = z.object({
  edits: z.record(
    z.string(),
    z.object({
      value: z.unknown(),
      meta: editedFieldMetaSchema,
    }),
  ),
});
export type EditedMetadata = z.infer<typeof editedMetadataSchema>;

/** Effective metadata after applying edits over extracted values. */
export const effectiveMetadataSchema = z.object({
  title: z.string().max(500).optional(),
  abstract: str.optional(),
  authors: z.array(extractedPersonSchema).default([]),
  keywords: z.array(z.string().max(100)).default([]),
  domains: z.array(z.string().max(100)).default([]),
  reviewType: reviewTypeSchema.optional(),
  license: z.string().max(120).optional(),
  repositoryUrl: httpsUrlSchema.optional(),
  publishedReviewUrl: httpsUrlSchema.optional(),
  commitSha: commitShaSchema.optional(),
  releaseTag: z.string().max(120).optional(),
  versionDoi: doiSchema.optional(),
  conceptDoi: doiSchema.optional(),
  zenodoRecordId: zenodoRecordIdSchema.optional(),
  contact: z.string().max(300).optional(),
  language: z.string().max(20).optional(),
});
export type EffectiveMetadata = z.infer<typeof effectiveMetadataSchema>;

/** Merge manual edits over extracted values into the effective metadata. */
export function resolveEffectiveMetadata(
  extracted: ExtractedMetadata | undefined,
  edited: EditedMetadata | undefined,
): EffectiveMetadata {
  const out: Record<string, unknown> = {};
  if (extracted) {
    for (const [key, field] of Object.entries(extracted.fields)) {
      if (field && typeof field === "object" && "value" in field) {
        out[key] = field.value;
      }
    }
  }
  if (edited) {
    for (const [key, edit] of Object.entries(edited.edits)) {
      out[key] = edit.value;
    }
  }
  return effectiveMetadataSchema.parse(out);
}
