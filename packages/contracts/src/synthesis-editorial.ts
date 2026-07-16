import { z } from "zod";
import { nodeRelationTypeSchema } from "./enums.js";
import { doiSchema } from "./identifiers.js";
import { synthesisReviewDocumentSchema } from "./synthesis-review.js";

export const SYNTHESIS_SELECTOR_VERSION = "synthesis-selector/1.0.0" as const;
export const SYNTHESIS_MATERIALIZATION_POLICY_VERSION = "synthesis-materialization/1.0.0" as const;
export const SYNTHESIS_ATTRIBUTION_POLICY_VERSION = "synthesis-attribution/1.0.0" as const;
export const SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION = "synthesis-checklist/1.0.0" as const;
export const SYNTHESIS_PIPELINE_SOFTWARE_NAME = "Open Review Atlas Synthesis Writer" as const;
export const SYNTHESIS_PIPELINE_SOFTWARE_ID = "software:oratlas-synthesis-writer" as const;

const boundedId = z.string().trim().min(1).max(200);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const synthesisSeriesSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seed"), nodeId: boundedId }).strict(),
  z
    .object({ kind: z.literal("topic"), canonicalQuery: z.string().trim().min(1).max(500) })
    .strict(),
]);

/** Every graph-selection and current-version choice that can affect reproducibility is explicit. */
export const synthesisSelectorSchema = z
  .object({
    schemaVersion: z.literal(SYNTHESIS_SELECTOR_VERSION),
    selection: synthesisSeriesSelectionSchema,
    depth: z.number().int().min(1).max(3),
    maxNodes: z.number().int().min(1).max(100),
    maxEdges: z.number().int().min(0).max(500),
    relationTypes: z.array(nodeRelationTypeSchema).min(1).max(7),
    trustPolicy: z.literal("authoritative-current-relation-trust-v1"),
    currentVersionPolicy: z.literal("newest-valid-no-history-fallback"),
    topicSeedPolicy: z.literal("current-public-title-abstract-search-v1"),
    topicSeedLimit: z.number().int().min(1).max(10),
    edgePolicy: z.literal("editor-confirmed-exact-versions-only"),
    includeContradictions: z.literal(true),
  })
  .strict()
  .superRefine((selector, context) => {
    if (new Set(selector.relationTypes).size !== selector.relationTypes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationTypes"],
        message: "Relation types must be unique.",
      });
    }
    if (!selector.relationTypes.includes("contradicts")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationTypes"],
        message: "Contradiction edges are required.",
      });
    }
    const sorted = [...selector.relationTypes].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    if (selector.relationTypes.some((value, index) => value !== sorted[index])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationTypes"],
        message: "Relation types must be code-unit sorted.",
      });
    }
    if (
      selector.selection.kind === "topic" &&
      selector.selection.canonicalQuery !==
        selector.selection.canonicalQuery
          .normalize("NFKC")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection", "canonicalQuery"],
        message: "Topic query must be canonical.",
      });
    }
  });
export type SynthesisSelector = z.infer<typeof synthesisSelectorSchema>;

export const synthesisGenerationRequestSchema = z
  .object({
    selector: synthesisSelectorSchema,
    requestKey: z.string().trim().min(8).max(200),
  })
  .strict();
export type SynthesisGenerationRequest = z.infer<typeof synthesisGenerationRequestSchema>;

const expectedRevision = z.number().int().min(0).max(1_000_000_000);
const decisionBase = {
  expectedRevision,
  idempotencyKey: z.string().trim().min(8).max(200),
  rationale: z.string().trim().min(10).max(4_000),
};
const normalizedDoiSchema = doiSchema
  .transform((value) => value.normalize("NFKC").toLowerCase())
  .refine((value) => !value.startsWith("10.5555/"), {
    message: "Reserved example DOI prefixes cannot be published as live synthesis identifiers.",
  });

export const synthesisAcceptanceChecklistSchema = z
  .object({
    groundingAndCitationsReviewed: z.literal(true),
    contradictionAndNonConsensusFramingReviewed: z.literal(true),
    attributionAndAiDisclosureReviewed: z.literal(true),
    limitationsReviewed: z.literal(true),
    privacyAndInjectionLeakageReviewed: z.literal(true),
    rightsAndLicenseConfirmed: z.literal(true),
  })
  .strict();

export const synthesisDraftDecisionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        ...decisionBase,
        action: z.literal("accept"),
        licenseSpdx: z.string().trim().min(1).max(120),
        rightsStatement: z.string().trim().min(10).max(2_000),
        versionDoi: normalizedDoiSchema.optional(),
        conceptDoi: normalizedDoiSchema.optional(),
        checklist: synthesisAcceptanceChecklistSchema,
      })
      .strict(),
    z.object({ ...decisionBase, action: z.literal("reject") }).strict(),
    z.object({ ...decisionBase, action: z.literal("request-regeneration") }).strict(),
  ])
  .superRefine((decision, context) => {
    if (
      decision.action === "accept" &&
      decision.versionDoi &&
      decision.conceptDoi &&
      decision.versionDoi === decision.conceptDoi
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conceptDoi"],
        message: "Concept DOI must differ from version DOI.",
      });
    }
  });
export type SynthesisDraftDecision = z.infer<typeof synthesisDraftDecisionSchema>;

export const synthesisGenerationProvenanceSchema = z
  .object({
    generationMode: z.enum(["llm", "deterministic-template"]),
    pipelineSoftware: z
      .object({
        id: z.literal(SYNTHESIS_PIPELINE_SOFTWARE_ID),
        kind: z.literal("software-agent"),
        displayName: z.literal(SYNTHESIS_PIPELINE_SOFTWARE_NAME),
        pipelineVersion: z.string().min(1).max(120),
      })
      .strict(),
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(200),
    modelVersion: z.string().min(1).max(200),
    promptVersion: z.string().min(1).max(120),
    promptHash: sha256,
    packetHash: sha256,
    documentHash: sha256,
    generatedAt: z.string().datetime(),
    attributionPolicyVersion: z.literal(SYNTHESIS_ATTRIBUTION_POLICY_VERSION),
    materializationPolicyVersion: z.literal(SYNTHESIS_MATERIALIZATION_POLICY_VERSION),
  })
  .strict();
export type SynthesisGenerationProvenance = z.infer<typeof synthesisGenerationProvenanceSchema>;

export const acceptedSynthesisProvenanceSchema = synthesisGenerationProvenanceSchema
  .extend({
    acceptedAt: z.string().datetime(),
    approvingEditor: z
      .object({
        displayName: z.string().min(1).max(200),
        githubLogin: z.string().min(1).max(100),
        roleSnapshot: z.enum(["EDITOR", "ADMIN"]),
      })
      .strict(),
    rightsStatement: z.string().min(10).max(2_000),
    licenseSpdx: z.string().min(1).max(120),
    checklistVersion: z.literal(SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION),
    acceptedPredecessorVersionId: boundedId.nullable(),
    acceptedPredecessorOrdinal: z.number().int().min(1).nullable(),
    ordinal: z.number().int().min(1),
  })
  .strict();
export type AcceptedSynthesisProvenance = z.infer<typeof acceptedSynthesisProvenanceSchema>;

export const editorialSynthesisDraftSchema = z
  .object({
    id: boundedId,
    status: z.enum(["pending", "accepted", "rejected", "regeneration-requested"]),
    revision: expectedRevision,
    seriesKey: sha256,
    selector: synthesisSelectorSchema,
    generationKey: sha256,
    regenerationOrdinal: z.number().int().min(1),
    parentDraftId: boundedId.optional(),
    previousAcceptedOrdinal: z.number().int().min(1).optional(),
    document: synthesisReviewDocumentSchema,
    provenance: synthesisGenerationProvenanceSchema,
    citations: z.array(
      z
        .object({
          referenceId: z.string().min(1),
          nodeId: boundedId,
          nodeVersionId: boundedId,
          nodeKind: z.enum(["claim", "figure", "dataset", "code"]),
          title: z.string().min(1).max(500),
          location: z.string().min(1).max(200),
          occurrenceOrdinal: z.number().int().nonnegative(),
          identifierScheme: z.string().min(1).max(40).optional(),
          identifierRole: z.string().min(1).max(80).optional(),
          identifierValue: z.string().min(1).max(500).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type EditorialSynthesisDraft = z.infer<typeof editorialSynthesisDraftSchema>;

/** Public synthesis DTO: deliberately no draft/run ids, packet/prompt bytes, keys, errors, or notes. */
export const publicSynthesisReviewSchema = z
  .object({
    slug: z.string().min(1).max(200),
    reviewType: z.literal("ai-synthesis"),
    title: z.string().min(1).max(300),
    abstract: z.string().min(1).max(2_000),
    document: synthesisReviewDocumentSchema,
    provenance: acceptedSynthesisProvenanceSchema,
    citations: z.array(
      z
        .object({
          referenceId: z.string().min(1),
          nodeId: boundedId,
          nodeVersionId: boundedId,
          nodeKind: z.enum(["claim", "figure", "dataset", "code"]),
          title: z.string().min(1).max(500),
          href: z.string().regex(/^\/nodes\/[^/]+\/versions\/[^/]+$/),
          location: z.string().min(1).max(200),
          occurrenceOrdinal: z.number().int().nonnegative(),
          identifierScheme: z.string().min(1).max(40).optional(),
          identifierRole: z.string().min(1).max(80).optional(),
          identifierValue: z.string().min(1).max(500).optional(),
        })
        .strict(),
    ),
    version: z
      .object({
        id: boundedId,
        ordinal: z.number().int().min(1),
        isCurrent: z.boolean(),
        versionDoi: doiSchema.optional(),
        conceptDoi: doiSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type PublicSynthesisReview = z.infer<typeof publicSynthesisReviewSchema>;
