import { z } from "zod";

export const PROTOCOL_SCHEMA_VERSION = "1.0.0";
export const PROTOCOL_CATEGORIES = [
  "population",
  "outcomes",
  "exclusions",
  "analysis-plan",
] as const;
export type ProtocolCategory = (typeof PROTOCOL_CATEGORIES)[number];

export const protocolRegistrySchema = z.enum(["osf", "clinicaltrials-gov"]);
export type ProtocolRegistry = z.infer<typeof protocolRegistrySchema>;

export const protocolEvidenceSchema = z
  .object({
    value: z.string().trim().min(1).max(10_000),
    sourcePointer: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type ProtocolEvidence = z.infer<typeof protocolEvidenceSchema>;

const registryUrlSchema = z
  .string()
  .url()
  .max(2_000)
  .refine(isCleanHttpsUrl, "Registry URL must use HTTPS without credentials, query, or fragment.");

const protocolFieldsShape = {
  population: z.array(protocolEvidenceSchema).max(200).default([]),
  outcomes: z.array(protocolEvidenceSchema).max(200).default([]),
  exclusions: z.array(protocolEvidenceSchema).max(200).default([]),
  "analysis-plan": z.array(protocolEvidenceSchema).max(200).default([]),
};

export const normalizedProtocolSchema = z
  .object({
    schemaVersion: z.literal(PROTOCOL_SCHEMA_VERSION),
    source: z
      .object({
        registry: protocolRegistrySchema,
        sourceId: z.string().trim().min(1).max(300),
        sourceUrl: registryUrlSchema,
        /** Exact upstream representation/version marker supplied by the registry response. */
        sourceVersion: z.string().trim().min(1).max(300),
        registeredAt: z.string().datetime().optional(),
        lastUpdatedAt: z.string().datetime().optional(),
        capturedAt: z.string().datetime(),
      })
      .strict(),
    title: z.string().trim().min(1).max(1_000),
    fields: z.object(protocolFieldsShape).strict(),
    /** Preserved registry answers that cannot be assigned safely to a comparison category. */
    unclassified: z.array(protocolEvidenceSchema).max(500).default([]),
  })
  .strict();
export type NormalizedProtocol = z.infer<typeof normalizedProtocolSchema>;

export const observedReviewSchema = z
  .object({
    reviewVersionId: z.string().min(1).max(200),
    targetKey: z.string().min(1).max(400),
    fields: z.object(protocolFieldsShape).strict(),
  })
  .strict();
export type ObservedReview = z.infer<typeof observedReviewSchema>;

export const protocolDriftKindSchema = z.enum([
  "not-described-in-review",
  "not-registered",
  "content-differs",
]);
export type ProtocolDriftKind = z.infer<typeof protocolDriftKindSchema>;

export const protocolDriftProposalSchema = z
  .object({
    id: z.string().regex(/^pdp_[a-f0-9]{64}$/),
    category: z.enum(PROTOCOL_CATEGORIES),
    kind: protocolDriftKindSchema,
    registered: z.array(protocolEvidenceSchema).max(200),
    observed: z.array(protocolEvidenceSchema).max(200),
    /** Deliberately neutral: this is a metadata reconciliation request, not an accusation. */
    rationale: z.string().min(1).max(2_000),
    comparatorVersion: z.string().min(1).max(40),
  })
  .strict();
export type ProtocolDriftProposal = z.infer<typeof protocolDriftProposalSchema>;

export const protocolSnapshotInputSchema = z
  .object({
    reviewVersionId: z.string().min(1).max(200),
    claimLocalId: z.string().trim().min(1).max(120).optional(),
    registry: protocolRegistrySchema,
    sourceUrl: registryUrlSchema,
    /** Mandatory exact version/ETag/timestamp; ingestion fails closed when absent. */
    sourceVersion: z.string().trim().min(1).max(300),
    fetchedAt: z.string().datetime(),
    payload: z.unknown(),
    /** OSF question labels, obtained from the registration schema endpoint. */
    osfQuestions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(300),
            label: z.string().min(1).max(2_000),
            category: z.union([z.enum(PROTOCOL_CATEGORIES), z.literal("unclassified")]),
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.registry === "osf" && !value.osfQuestions?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["osfQuestions"],
        message: "OSF question ids and labels are required to interpret registered_meta safely.",
      });
    }
    if (value.registry !== "osf" && value.osfQuestions !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["osfQuestions"],
        message: "OSF question metadata is only valid for OSF registrations.",
      });
    }
    const questionIds = new Set<string>();
    for (const [index, question] of (value.osfQuestions ?? []).entries()) {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["osfQuestions", index, "id"],
          message: "OSF question ids must be unique.",
        });
      }
      questionIds.add(question.id);
    }
    const host = urlHost(value.sourceUrl);
    const allowedHost =
      value.registry === "osf"
        ? host === "osf.io" || host === "api.osf.io"
        : host === "clinicaltrials.gov" || host === "www.clinicaltrials.gov";
    if (!allowedHost) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceUrl"],
        message: "Source URL host must match the selected registry.",
      });
    }
  });
export type ProtocolSnapshotInput = z.infer<typeof protocolSnapshotInputSchema>;

export const protocolProposalResolutionSchema = z
  .object({
    resolution: z.enum(["confirmed-update-needed", "explained", "dismissed"]),
    note: z.string().trim().min(10).max(4_000),
  })
  .strict();
export type ProtocolProposalResolution = z.infer<typeof protocolProposalResolutionSchema>;

function isCleanHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function urlHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}
