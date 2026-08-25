import { z } from "zod";
import { conflictOfInterestSnapshotSchema } from "./conflicts-of-interest.js";
import { publicationHttpsUrlSchema, publicationSha256Schema } from "./publications.js";

export const CERTIFICATION_RESULT_SCHEMA_VERSION = "1.0.0" as const;
export const CERTIFIER_STATUSES = ["active", "suspended", "retired"] as const;
export const certifierStatusSchema = z.enum(CERTIFIER_STATUSES);
export const CERTIFICATION_PROTOCOL_STATUSES = ["active", "retired"] as const;
export const certificationProtocolStatusSchema = z.enum(CERTIFICATION_PROTOCOL_STATUSES);
export const CERTIFICATION_ASSESSMENT_MODES = ["human", "ai", "hybrid"] as const;
export const certificationAssessmentModeSchema = z.enum(CERTIFICATION_ASSESSMENT_MODES);
export const CERTIFICATION_RUN_STATUSES = [
  "requested",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const certificationRunStatusSchema = z.enum(CERTIFICATION_RUN_STATUSES);
export const CERTIFICATION_CRITERION_STATUSES = [
  "pass",
  "concern",
  "fail",
  "not-applicable",
  "insufficient-evidence",
] as const;
export const certificationCriterionStatusSchema = z.enum(CERTIFICATION_CRITERION_STATUSES);
export const CERTIFICATION_OUTCOMES = [
  "certified",
  "certified-with-conditions",
  "not-certified",
  "inconclusive",
] as const;
export const certificationOutcomeSchema = z.enum(CERTIFICATION_OUTCOMES);
export const CERTIFICATION_CREDENTIAL_SCOPES = [
  "certification:read",
  "certification:submit",
] as const;
export const certifierCredentialScopeSchema = z.enum(CERTIFICATION_CREDENTIAL_SCOPES);
export const CERTIFICATION_LIFECYCLE_KINDS = [
  "issued",
  "superseded",
  "withdrawn",
  "revoked",
] as const;
export const certificationLifecycleKindSchema = z.enum(CERTIFICATION_LIFECYCLE_KINDS);

const stableKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
export const certificationCriterionSchema = z
  .object({
    id: stableKeySchema,
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(4_000),
    required: z.boolean(),
    allowedStatuses: z.array(certificationCriterionStatusSchema).min(1).max(5),
    evidenceRequired: z.boolean().default(false),
    evidenceRequiredForStatuses: z
      .array(certificationCriterionStatusSchema)
      .min(1)
      .max(5)
      .optional(),
  })
  .strict();

export const CERTIFICATION_PACKET_SECTIONS = [
  "captures",
  "content",
  "contributors",
  "occurrences",
  "productionProvenance",
  "relations",
  "challenges",
] as const;
export const certificationPacketSectionSchema = z.enum(CERTIFICATION_PACKET_SECTIONS);
export const certificationProtocolDefinitionSchema = z
  .object({
    criteria: z.array(certificationCriterionSchema).min(1).max(100),
    assessmentModes: z.array(certificationAssessmentModeSchema).min(1).max(3),
    outcomes: z.array(certificationOutcomeSchema).min(1).max(4),
    requireCompleteSections: z.array(certificationPacketSectionSchema).max(7).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.criteria.map((criterion) => criterion.id)).size !== value.criteria.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criteria"],
        message: "Criterion ids must be unique.",
      });
    }
    value.criteria.forEach((criterion, index) => {
      const statuses = criterion.evidenceRequiredForStatuses ?? [];
      if (new Set(statuses).size !== statuses.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["criteria", index, "evidenceRequiredForStatuses"],
          message: "Evidence-required statuses must be unique.",
        });
      }
      for (const status of statuses) {
        if (!criterion.allowedStatuses.includes(status)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["criteria", index, "evidenceRequiredForStatuses"],
            message: `Evidence cannot be required for disallowed status '${status}'.`,
          });
        }
      }
    });
    for (const field of ["assessmentModes", "outcomes", "requireCompleteSections"] as const) {
      if (new Set(value[field]).size !== value[field].length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must not contain duplicates.`,
        });
      }
    }
  });
export type CertificationProtocolDefinition = z.infer<typeof certificationProtocolDefinitionSchema>;

export const createCertifierSchema = z
  .object({
    slug: stableKeySchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(4_000),
    publicUrl: publicationHttpsUrlSchema.optional(),
    governanceUrl: publicationHttpsUrlSchema.optional(),
    publicContact: z.string().email().max(320).optional(),
  })
  .strict();
export const createCertificationProtocolSchema = z
  .object({
    certifierId: z.string().min(1),
    seriesKey: stableKeySchema,
    version: z.string().min(1).max(50),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(4_000),
    definition: certificationProtocolDefinitionSchema,
    supersedesProtocolId: z.string().min(1).optional(),
  })
  .strict();
export const issueCertifierCredentialSchema = z
  .object({
    label: z.string().min(1).max(100),
    scopes: z.array(certifierCredentialScopeSchema).min(1).max(2),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export const createCertificationRunSchema = z
  .object({
    publicationVersionId: z.string().min(1),
    certificationProtocolId: z.string().min(1),
    assessmentMode: certificationAssessmentModeSchema,
    externalRunReference: z.string().min(1).max(200).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export const certificationRunTerminalTransitionSchema = z
  .object({
    status: z.enum(["failed", "cancelled"]),
    reason: z.string().trim().min(1).max(4_000),
  })
  .strict();
export type CertificationRunTerminalTransition = z.infer<
  typeof certificationRunTerminalTransitionSchema
>;

const packetEvidenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("publication-occurrence"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("publication-content-document"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("canonical-node-version"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("canonical-relation"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("trust-assessment"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("production-provenance"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("capture"), id: z.string().min(1) }).strict(),
]);
export const certificationEvidenceReferenceSchema = z.union([
  packetEvidenceSchema,
  z
    .object({
      type: z.literal("external-immutable-resource"),
      url: publicationHttpsUrlSchema,
      sha256: publicationSha256Schema,
    })
    .strict(),
]);
export type CertificationEvidenceReference = z.infer<typeof certificationEvidenceReferenceSchema>;
export const certificationCriterionResultSchema = z
  .object({
    criterionId: stableKeySchema,
    status: certificationCriterionStatusSchema,
    rationale: z.string().min(1).max(10_000),
    evidenceRefs: z.array(certificationEvidenceReferenceSchema).max(100).default([]),
  })
  .strict();
export type CertificationCriterionResult = z.infer<typeof certificationCriterionResultSchema>;
export const submitCertificationResultSchema = z
  .object({
    schemaVersion: z.literal(CERTIFICATION_RESULT_SCHEMA_VERSION),
    packetSha256: publicationSha256Schema,
    criteria: z.array(certificationCriterionResultSchema).min(1).max(100),
    outcome: certificationOutcomeSchema,
    limitations: z.array(z.string().min(1).max(2_000)).max(50).default([]),
    conflictOfInterest: conflictOfInterestSnapshotSchema,
    independence: z
      .object({ declared: z.boolean(), statement: z.string().min(1).max(4_000) })
      .strict(),
    provenance: z
      .object({
        agentRunId: z.string().min(1).optional(),
        executionPassportId: z.string().min(1).optional(),
        provider: z.string().min(1).max(120).optional(),
        model: z.string().min(1).max(120).optional(),
        modelVersion: z.string().min(1).max(120).optional(),
        promptVersion: z.string().min(1).max(120).optional(),
        structuredOutputSha256: publicationSha256Schema.optional(),
      })
      .strict()
      .default({}),
    supersedesCertificationResultId: z.string().min(1).optional(),
  })
  .strict();
export type SubmitCertificationResult = z.infer<typeof submitCertificationResultSchema>;
export const certificationLifecycleRequestSchema = z
  .object({
    kind: z.enum(["withdrawn", "revoked"]),
    reason: z.string().min(1).max(4_000),
  })
  .strict();

/** Public accountable actor projection. Never implies ORAtlas endorsement. */
export const publicCertifierSchema = z
  .object({
    id: z.string().min(1),
    slug: stableKeySchema,
    name: z.string().min(1),
    description: z.string().min(1),
    publicUrl: publicationHttpsUrlSchema.nullable(),
    governanceUrl: publicationHttpsUrlSchema.nullable(),
    publicContact: z.string().email().nullable(),
    status: certifierStatusSchema,
    createdAt: z.string().datetime(),
    activatedAt: z.string().datetime().nullable(),
    retiredAt: z.string().datetime().nullable(),
    href: z.string().startsWith("/"),
  })
  .strict();

export const publicCertificationProtocolSchema = z
  .object({
    id: z.string().min(1),
    certifier: z
      .object({ id: z.string().min(1), slug: stableKeySchema, name: z.string().min(1) })
      .strict()
      .optional(),
    certifierId: z.string().min(1),
    seriesKey: stableKeySchema,
    version: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    definition: certificationProtocolDefinitionSchema,
    sha256: publicationSha256Schema,
    status: certificationProtocolStatusSchema,
    supersedesProtocolId: z.string().nullable(),
    createdAt: z.string().datetime(),
    href: z.string().startsWith("/"),
  })
  .strict();

/** Public result projection always qualifies the outcome by certifier and protocol version. */
export const publicCertificationSummarySchema = z
  .object({
    id: z.string().min(1),
    publicationVersionId: z.string().min(1),
    certifier: z
      .object({ id: z.string().min(1), slug: stableKeySchema, name: z.string().min(1) })
      .strict(),
    protocol: z
      .object({
        id: z.string().min(1),
        seriesKey: stableKeySchema,
        version: z.string().min(1),
        sha256: publicationSha256Schema,
        title: z.string().min(1),
      })
      .strict(),
    outcome: certificationOutcomeSchema,
    assessmentMode: certificationAssessmentModeSchema,
    issuedAt: z.string().datetime(),
    lifecycle: z
      .array(
        z
          .object({
            kind: certificationLifecycleKindSchema,
            reason: z.string().nullable(),
            createdAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1),
    lifecycleState: certificationLifecycleKindSchema,
    href: z.string().startsWith("/"),
  })
  .strict();
