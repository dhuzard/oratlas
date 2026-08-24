import { z } from "zod";

/** How substantive scholarly production was declared to have been performed. */
export const PUBLICATION_PRODUCTION_MODES = [
  "human",
  "ai-assisted",
  "agentic",
  "hybrid",
  "unspecified",
] as const;
export const publicationProductionModeSchema = z.enum(PUBLICATION_PRODUCTION_MODES);
export type PublicationProductionMode = z.infer<typeof publicationProductionModeSchema>;

/** Bounded activities, not a claim of authorship or scientific merit. */
export const PUBLICATION_PRODUCTION_ACTIVITIES = [
  "study-design",
  "evidence-search",
  "evidence-synthesis",
  "data-analysis",
  "drafting",
  "authoring",
  "editing",
  "reviewing",
  "figure-generation",
  "code-generation",
  "other",
] as const;
export const publicationProductionActivitySchema = z.enum(PUBLICATION_PRODUCTION_ACTIVITIES);
export type PublicationProductionActivity = z.infer<typeof publicationProductionActivitySchema>;

/** Production actors are deliberately separate from scholarly contributors. */
export const PUBLICATION_PRODUCTION_ACTOR_KINDS = [
  "person",
  "organization",
  "software",
  "workflow",
  "ai-system",
] as const;
export const publicationProductionActorKindSchema = z.enum(PUBLICATION_PRODUCTION_ACTOR_KINDS);
export type PublicationProductionActorKind = z.infer<typeof publicationProductionActorKindSchema>;

export const publicationProductionActorSchema = z
  .object({
    kind: publicationProductionActorKindSchema,
    name: z.string().trim().min(1).max(300).optional(),
    /** Declared stable or public identifier; never inferred from the name. */
    identifier: z.string().trim().min(1).max(500).optional(),
    version: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    modelVersion: z.string().trim().min(1).max(120).optional(),
    publicUrl: z.string().url().startsWith("https://").max(2_000).optional(),
  })
  .strict()
  .refine((actor) => actor.name !== undefined || actor.identifier !== undefined, {
    message: "A production actor requires a declared name or identifier.",
  });
export type PublicationProductionActor = z.infer<typeof publicationProductionActorSchema>;

export const PUBLICATION_PRODUCTION_ASSERTION_STRENGTHS = [
  "source-declared",
  "oratlas-attested",
] as const;
export const publicationProductionAssertionStrengthSchema = z.enum(
  PUBLICATION_PRODUCTION_ASSERTION_STRENGTHS,
);
export type PublicationProductionAssertionStrength = z.infer<
  typeof publicationProductionAssertionStrengthSchema
>;

const productionAssertionCoreShape = {
  mode: publicationProductionModeSchema,
  actors: z.array(publicationProductionActorSchema).max(64).default([]),
  activities: z.array(publicationProductionActivitySchema).max(32).default([]),
  statement: z.string().trim().min(1).max(5_000).optional(),
  strength: publicationProductionAssertionStrengthSchema,
  publicEvidenceUrl: z.string().url().startsWith("https://").max(2_000).optional(),
  agentRunId: z.string().trim().min(1).max(200).optional(),
  executionPassportId: z.string().trim().min(1).max(200).optional(),
} as const;

function validateProductionAssertion(
  value: {
    strength: PublicationProductionAssertionStrength;
    agentRunId?: string;
    executionPassportId?: string;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.strength === "source-declared" &&
    (value.agentRunId !== undefined || value.executionPassportId !== undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strength"],
      message: "Source-declared provenance cannot cite ORAtlas execution records.",
    });
  }
  if (
    value.strength === "oratlas-attested" &&
    value.agentRunId === undefined &&
    value.executionPassportId === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strength"],
      message: "ORAtlas-attested provenance requires an exact execution record.",
    });
  }
}

/** Adapter-normalized source assertion; absent is the normal legacy state. */
export const normalizedPublicationProductionAssertionSchema = z
  .object({
    sourceAssertionKey: z.string().trim().min(1).max(300),
    ...productionAssertionCoreShape,
    strength: z.literal("source-declared"),
  })
  .strict()
  .superRefine(validateProductionAssertion);
export type NormalizedPublicationProductionAssertion = z.infer<
  typeof normalizedPublicationProductionAssertionSchema
>;

export const publicationProductionAssertionMutationSchema = z
  .object({
    ...productionAssertionCoreShape,
    supersedesAssertionId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine(validateProductionAssertion);
export type PublicationProductionAssertionMutation = z.infer<
  typeof publicationProductionAssertionMutationSchema
>;

export const PUBLICATION_PRODUCTION_ASSERTION_STATES = ["active", "superseded"] as const;
export const publicationProductionAssertionStateSchema = z.enum(
  PUBLICATION_PRODUCTION_ASSERTION_STATES,
);

export const publicPublicationProductionAssertionSchema = z
  .object({
    id: z.string().min(1),
    publicationVersionId: z.string().min(1),
    sourceAssertionKey: z.string().nullable(),
    mode: publicationProductionModeSchema,
    actors: z.array(publicationProductionActorSchema).max(64),
    activities: z.array(publicationProductionActivitySchema).max(32),
    statement: z.string().nullable(),
    strength: publicationProductionAssertionStrengthSchema,
    lifecycleState: publicationProductionAssertionStateSchema,
    publicEvidenceUrl: z.string().url().startsWith("https://").max(2_000).nullable(),
    agentRunId: z.string().nullable(),
    executionPassportId: z.string().nullable(),
    supersedesAssertionId: z.string().nullable(),
    supersededByAssertionId: z.string().nullable(),
    assertedBy: z
      .object({ id: z.string().min(1), githubLogin: z.string().min(1) })
      .strict()
      .nullable(),
    assertedAt: z.string().datetime(),
    links: z
      .object({
        publicationVersion: z.string().startsWith("/"),
        executionPassport: z.string().startsWith("/").nullable(),
        publicEvidence: z.string().url().startsWith("https://").nullable(),
      })
      .strict(),
  })
  .strict();
export type PublicPublicationProductionAssertion = z.infer<
  typeof publicPublicationProductionAssertionSchema
>;

export const PUBLICATION_PRODUCTION_ASSERTION_LIMIT = 200;

export const publicationProductionProvenanceResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    publicationVersionId: z.string().min(1),
    assertions: z
      .array(publicPublicationProductionAssertionSchema)
      .max(PUBLICATION_PRODUCTION_ASSERTION_LIMIT),
    completeness: z
      .object({
        returned: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const PUBLICATION_RELATION_TYPES = [
  "same-publication-continuation",
  "mirror-of",
  "moved-to",
  "derived-from",
  "republication-of",
  "version-of",
] as const;
export const publicationRelationTypeSchema = z.enum(PUBLICATION_RELATION_TYPES);
export type PublicationRelationType = z.infer<typeof publicationRelationTypeSchema>;

export const publicationRelationMutationSchema = z
  .object({
    targetPublicationId: z.string().trim().min(1).max(200),
    relationType: publicationRelationTypeSchema,
    rationale: z.string().trim().min(20).max(5_000),
    publicEvidenceUrl: z.string().url().startsWith("https://").max(2_000).optional(),
  })
  .strict();
export type PublicationRelationMutation = z.infer<typeof publicationRelationMutationSchema>;

export const publicPublicationRelationSchema = z
  .object({
    id: z.string().min(1),
    sourcePublicationId: z.string().min(1),
    targetPublicationId: z.string().min(1),
    relationType: publicationRelationTypeSchema,
    direction: z.enum(["outgoing", "incoming"]),
    rationale: z.string().min(1),
    publicEvidenceUrl: z.string().url().startsWith("https://").max(2_000).nullable(),
    reviewedBy: z.object({ id: z.string().min(1), githubLogin: z.string().min(1) }).strict(),
    reviewedAt: z.string().datetime(),
    links: z
      .object({
        sourcePublication: z.string().startsWith("/"),
        targetPublication: z.string().startsWith("/"),
        publicEvidence: z.string().url().startsWith("https://").nullable(),
      })
      .strict(),
  })
  .strict();
export type PublicPublicationRelation = z.infer<typeof publicPublicationRelationSchema>;

export const PUBLICATION_RELATION_LIMIT = 500;

export const publicationRelationsResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    publicationId: z.string().min(1),
    relations: z.array(publicPublicationRelationSchema).max(PUBLICATION_RELATION_LIMIT),
    completeness: z
      .object({
        returned: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict();
