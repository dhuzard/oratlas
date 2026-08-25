import { z } from "zod";
import { publicationHttpsUrlSchema, publicationSha256Schema } from "./publications.js";

export const VERIFICATION_API_SCHEMA_VERSION = "1.0.0" as const;
export const VERIFICATION_INPUT_PROFILE_VERSION = "1.0.0" as const;
export const VERIFIER_STATUSES = ["active", "suspended", "retired"] as const;
export const verifierStatusSchema = z.enum(VERIFIER_STATUSES);
export const VERIFICATION_CREDENTIAL_SCOPES = ["verification:read", "verification:submit"] as const;
export const verifierCredentialScopeSchema = z.enum(VERIFICATION_CREDENTIAL_SCOPES);
export const VERIFICATION_PROTOCOL_STATUSES = ["active", "retired"] as const;
export const verificationProtocolStatusSchema = z.enum(VERIFICATION_PROTOCOL_STATUSES);
export const VERIFICATION_EXECUTION_MODES = [
  "deterministic",
  "human",
  "ai",
  "hybrid",
  "external-execution",
] as const;
export const verificationExecutionModeSchema = z.enum(VERIFICATION_EXECUTION_MODES);
export const VERIFICATION_SUBJECT_TYPES = [
  "publication-version",
  "publication-claim-occurrence",
  "knowledge-node-version",
] as const;
export const verificationSubjectTypeSchema = z.enum(VERIFICATION_SUBJECT_TYPES);
export const verificationSubjectSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("publication-version"), publicationVersionId: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal("publication-claim-occurrence"),
      publicationClaimOccurrenceId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("knowledge-node-version"),
      knowledgeNodeVersionId: z.string().min(1),
    })
    .strict(),
]);
export type VerificationSubject = z.infer<typeof verificationSubjectSchema>;

export const VERIFICATION_RUN_STATUSES = [
  "requested",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const verificationRunStatusSchema = z.enum(VERIFICATION_RUN_STATUSES);
export const VERIFICATION_INPUT_PROFILES = ["full", "blinded-scientific"] as const;
export const verificationInputProfileSchema = z.enum(VERIFICATION_INPUT_PROFILES);
export const VERIFICATION_FINDING_STATUSES = [
  "verified",
  "partially-verified",
  "discrepancy",
  "failed",
  "unverifiable",
  "not-applicable",
] as const;
export const verificationFindingStatusSchema = z.enum(VERIFICATION_FINDING_STATUSES);
export const VERIFICATION_FINDING_IMPACTS = [
  "informational",
  "minor",
  "major",
  "critical",
] as const;
export const verificationFindingImpactSchema = z.enum(VERIFICATION_FINDING_IMPACTS);
export const VERIFICATION_ARTIFACT_VISIBILITIES = ["private", "public"] as const;
export const verificationArtifactVisibilitySchema = z.enum(VERIFICATION_ARTIFACT_VISIBILITIES);
export const VERIFICATION_ARTIFACT_STATUSES = ["prepared", "uploaded", "completed"] as const;
export const verificationArtifactStatusSchema = z.enum(VERIFICATION_ARTIFACT_STATUSES);

export const verificationStableKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const MEDIA_TYPE_TOKEN_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789!#$&^_.+-";
function validMediaType(value: string): boolean {
  const parts = value.split(";");
  const essence = parts.shift()?.trim() ?? "";
  const slash = essence.indexOf("/");
  const token = (candidate: string) =>
    candidate.length > 0 &&
    [...candidate.toLowerCase()].every((character) =>
      MEDIA_TYPE_TOKEN_CHARACTERS.includes(character),
    );
  if (slash <= 0 || slash !== essence.lastIndexOf("/") || !token(essence.slice(0, slash)))
    return false;
  if (!token(essence.slice(slash + 1))) return false;
  return parts.every((part) => {
    const parameter = part.trim();
    const equals = parameter.indexOf("=");
    return (
      equals > 0 &&
      token(parameter.slice(0, equals).trim()) &&
      parameter.slice(equals + 1).trim().length > 0 &&
      !parameter.includes("\r") &&
      !parameter.includes("\n")
    );
  });
}
const mediaTypeSchema = z.string().min(3).max(200).refine(validMediaType, "Invalid media type.");

function jsonDepth(value: unknown, depth = 0): number {
  if (depth > 12) return depth;
  if (Array.isArray(value))
    return Math.max(depth, ...value.map((item) => jsonDepth(item, depth + 1)));
  if (typeof value === "object" && value !== null)
    return Math.max(depth, ...Object.values(value).map((item) => jsonDepth(item, depth + 1)));
  return depth;
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((item) => isJsonValue(item, seen));
}

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Generic structured scientific output: JSON-only, depth- and byte-bounded. */
export const verificationStructuredJsonSchema = z
  .unknown()
  .refine(isJsonValue, "Must be plain finite JSON.")
  .refine((value) => jsonDepth(value) <= 12, "JSON nesting exceeds the verification limit.")
  .refine(
    (value) => isJsonValue(value) && jsonBytes(value) <= 64 * 1024,
    "Structured verification JSON exceeds 64 KiB.",
  );

export const createVerifierSchema = z
  .object({
    slug: verificationStableKeySchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4_000),
    publicUrl: publicationHttpsUrlSchema.optional(),
  })
  .strict();
export const issueVerifierCredentialSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    scopes: z.array(verifierCredentialScopeSchema).min(1).max(2),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export const createVerificationProtocolSchema = z
  .object({
    authorityVerifierId: z.string().min(1),
    seriesKey: verificationStableKeySchema,
    protocolVersion: z.string().trim().min(1).max(50),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4_000),
    verificationType: verificationStableKeySchema,
    executionMode: verificationExecutionModeSchema,
    supportedSubjectTypes: z.array(verificationSubjectTypeSchema).min(1).max(3),
    definition: verificationStructuredJsonSchema,
    supersedesProtocolId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.supportedSubjectTypes).size !== value.supportedSubjectTypes.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedSubjectTypes"],
        message: "Supported subject types must be unique.",
      });
  });
export type CreateVerificationProtocol = z.infer<typeof createVerificationProtocolSchema>;

export const createVerificationRunSchema = z
  .object({
    verificationProtocolId: z.string().min(1),
    subject: verificationSubjectSchema,
    inputProfile: verificationInputProfileSchema.default("full"),
    inputProfileVersion: z
      .literal(VERIFICATION_INPUT_PROFILE_VERSION)
      .default(VERIFICATION_INPUT_PROFILE_VERSION),
    idempotencyKey: z.string().min(8).max(200),
    replicationBriefId: z.string().min(1).optional(),
    agentRunId: z.string().min(1).optional(),
    executionPassportId: z.string().min(1).optional(),
  })
  .strict();
export type CreateVerificationRun = z.infer<typeof createVerificationRunSchema>;

export const claimVerificationRunSchema = z
  .object({ leaseSeconds: z.number().int().min(60).max(900).default(300) })
  .strict();

export const verificationRunTransitionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running") }).strict(),
  z.object({ status: z.literal("completed") }).strict(),
  z.object({ status: z.literal("failed"), reason: z.string().trim().min(1).max(4_000) }).strict(),
  z
    .object({ status: z.literal("cancelled"), reason: z.string().trim().min(1).max(4_000) })
    .strict(),
]);

export const VERIFICATION_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024;
export const prepareVerificationArtifactSchema = z
  .object({
    artifactKey: verificationStableKeySchema,
    kind: verificationStableKeySchema,
    mediaType: mediaTypeSchema,
    sha256: publicationSha256Schema,
    byteLength: z.number().int().nonnegative().max(VERIFICATION_ARTIFACT_MAX_BYTES),
    visibility: verificationArtifactVisibilitySchema.default("public"),
  })
  .strict();
export const completeVerificationArtifactSchema = z
  .object({ artifactId: z.string().min(1) })
  .strict();

export const verificationEvidenceReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("publication-content-document"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("publication-occurrence"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("canonical-node-version"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("canonical-relation"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("capture"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("production-provenance"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("execution-passport"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("verification-artifact"), id: z.string().min(1) }).strict(),
]);
export type VerificationEvidenceReference = z.infer<typeof verificationEvidenceReferenceSchema>;

export const submitVerificationFindingSchema = z
  .object({
    findingKey: verificationStableKeySchema,
    findingType: verificationStableKeySchema,
    status: verificationFindingStatusSchema,
    impact: verificationFindingImpactSchema,
    statement: z.string().trim().min(1).max(10_000),
    rationale: z.string().trim().min(1).max(20_000),
    reported: verificationStructuredJsonSchema.optional(),
    observed: verificationStructuredJsonSchema.optional(),
    tolerance: verificationStructuredJsonSchema.optional(),
    evidenceRefs: z.array(verificationEvidenceReferenceSchema).max(100).default([]),
    artifactRefs: z.array(z.string().min(1)).max(100).default([]),
    supersedesFindingId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.artifactRefs).size !== value.artifactRefs.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactRefs"],
        message: "Artifact references must be unique.",
      });
    const evidenceKeys = value.evidenceRefs.map((reference) => `${reference.type}:${reference.id}`);
    if (new Set(evidenceKeys).size !== evidenceKeys.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Evidence references must be unique.",
      });
  });
export type SubmitVerificationFinding = z.infer<typeof submitVerificationFindingSchema>;

export const publicVerifierSchema = z
  .object({
    id: z.string().min(1),
    slug: verificationStableKeySchema,
    name: z.string().min(1),
    description: z.string().min(1),
    publicUrl: publicationHttpsUrlSchema.nullable(),
    status: verifierStatusSchema,
    createdAt: z.string().datetime(),
    href: z.string().startsWith("/"),
  })
  .strict();

export const VERIFICATION_LEASE_HEADER = "x-oratlas-verification-lease" as const;
