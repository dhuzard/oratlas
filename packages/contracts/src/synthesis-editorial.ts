import { z } from "zod";
import { nodeRelationTypeSchema } from "./enums.js";
import { doiSchema } from "./identifiers.js";
import { synthesisSpdxExpressionSchema } from "./licenses.js";
import { synthesisReviewDocumentSchema } from "./synthesis-review.js";

export const SYNTHESIS_SELECTOR_VERSION = "synthesis-selector/1.0.0" as const;
/** Append-only registries: never remove a version while an accepted record may reference it. */
export const SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS = [
  "synthesis-materialization/1.0.0",
] as const;
export const SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS = [
  "synthesis-attribution/1.0.0",
] as const;
export const SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS = [
  "synthesis-checklist/1.0.0",
] as const;
export const SYNTHESIS_MATERIALIZATION_POLICY_VERSION =
  SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS[
    SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS.length - 1
  ]!;
export const SYNTHESIS_ATTRIBUTION_POLICY_VERSION =
  SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS[
    SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS.length - 1
  ]!;
export const SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION =
  SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS[
    SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS.length - 1
  ]!;
export const SYNTHESIS_PIPELINE_SOFTWARE_NAME = "Open Review Atlas Synthesis Writer" as const;
export const SYNTHESIS_PIPELINE_SOFTWARE_ID = "software:oratlas-synthesis-writer" as const;
export const SYNTHESIS_STALENESS_POLICY_VERSION = "synthesis-staleness/1.0.0" as const;
/** Two disjoint max-size packets (100 nodes + 500 edges each), plus policy drift. */
export const SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX = 1_201 as const;

export const SYNTHESIS_STALENESS_REASON_CODES = [
  "materialization-policy-changed",
  "node-head-changed",
  "membership-added",
  "membership-removed",
  "confirmed-edge-added",
  "confirmed-edge-removed",
  "confirmed-edge-changed",
  "trust-changed",
  "packet-content-changed",
  "materialization-failed",
] as const;
export const synthesisStalenessReasonCodeSchema = z.enum(SYNTHESIS_STALENESS_REASON_CODES);
export type SynthesisStalenessReasonCode = z.infer<typeof synthesisStalenessReasonCodeSchema>;

export const synthesisStalenessAffectedReferenceSchema = z
  .object({
    kind: z.enum(["node", "edge", "trust", "policy"]),
    id: z.string().min(1).max(200),
    change: z.enum(["added", "removed", "changed"]),
    previousVersionId: z.string().min(1).max(200).optional(),
    currentVersionId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    const validNodeVersions =
      reference.kind === "node" &&
      (reference.change === "added"
        ? !reference.previousVersionId && !!reference.currentVersionId
        : reference.change === "removed"
          ? !!reference.previousVersionId && !reference.currentVersionId
          : !!reference.previousVersionId && !!reference.currentVersionId);
    const validOther =
      reference.kind !== "node" &&
      reference.previousVersionId === undefined &&
      reference.currentVersionId === undefined;
    if (!validNodeVersions && !validOther) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only node references carry exact old/new version identity.",
      });
    }
  });
export type SynthesisStalenessAffectedReference = z.infer<
  typeof synthesisStalenessAffectedReferenceSchema
>;

export const synthesisFreshnessSchema = z
  .object({
    status: z.enum(["unchecked", "fresh", "stale"]),
    policyVersion: z.literal(SYNTHESIS_STALENESS_POLICY_VERSION),
    evaluatedAt: z.string().datetime().optional(),
    reasonCodes: z
      .array(synthesisStalenessReasonCodeSchema)
      .max(SYNTHESIS_STALENESS_REASON_CODES.length),
    affectedReferenceCount: z.number().int().min(0).max(SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX),
  })
  .strict()
  .superRefine((freshness, context) => {
    const expectedReasons = SYNTHESIS_STALENESS_REASON_CODES.filter((reason) =>
      freshness.reasonCodes.includes(reason),
    );
    if (
      expectedReasons.length !== freshness.reasonCodes.length ||
      expectedReasons.some((reason, index) => reason !== freshness.reasonCodes[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCodes"],
        message: "Freshness reason codes must be unique and canonically ordered.",
      });
    }
    if (
      (freshness.status === "unchecked" &&
        (freshness.evaluatedAt !== undefined ||
          freshness.reasonCodes.length !== 0 ||
          freshness.affectedReferenceCount !== 0)) ||
      (freshness.status === "fresh" && freshness.reasonCodes.length !== 0) ||
      (freshness.status === "stale" && freshness.reasonCodes.length === 0) ||
      (freshness.status !== "unchecked" && freshness.evaluatedAt === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Freshness status does not match its evaluation summary.",
      });
    }
  });
export type SynthesisFreshness = z.infer<typeof synthesisFreshnessSchema>;

export const synthesisRegenerationProposalDecisionSchema = z
  .object({
    action: z.enum(["request-regeneration", "dismiss"]),
    expectedRevision: z.number().int().min(0).max(1_000_000_000),
    idempotencyKey: z.string().trim().min(8).max(200),
    rationale: z.string().trim().min(10).max(4_000),
  })
  .strict();
export type SynthesisRegenerationProposalDecision = z.infer<
  typeof synthesisRegenerationProposalDecisionSchema
>;

export const synthesisStalenessScanRequestSchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict();
export const synthesisStalenessScanFailureSchema = z
  .object({
    code: z.literal("evaluation-failed"),
    reviewSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(200)
      .optional(),
  })
  .strict();
export const SYNTHESIS_PUBLIC_AI_LABEL = "AI-generated synthesis — editor-accepted" as const;
export const SYNTHESIS_PUBLIC_SCOPE_NOTICE =
  "Generated from cited evidence by software. Editorial acceptance permits publication; it does not establish peer review, scientific correctness, or consensus." as const;
export const SYNTHESIS_PUBLIC_REVIEW_FIELDS = [
  "slug",
  "reviewType",
  "title",
  "abstract",
  "document",
  "provenance",
  "citations",
  "version",
] as const;
export const SYNTHESIS_PUBLIC_PROVENANCE_FIELDS = [
  "generationMode",
  "pipelineSoftware",
  "provider",
  "model",
  "modelVersion",
  "promptVersion",
  "promptHash",
  "packetHash",
  "documentHash",
  "generatedAt",
  "attributionPolicyVersion",
  "materializationPolicyVersion",
  "acceptedAt",
  "approvingEditor",
  "rightsStatement",
  "licenseSpdx",
  "checklistVersion",
  "acceptedPredecessorVersionId",
  "acceptedPredecessorOrdinal",
  "ordinal",
] as const;
export const SYNTHESIS_PUBLIC_CITATION_FIELDS = [
  "referenceId",
  "nodeId",
  "nodeVersionId",
  "nodeKind",
  "title",
  "href",
  "location",
  "occurrenceOrdinal",
  "identifierScheme",
  "identifierRole",
  "identifierValue",
] as const;
export const SYNTHESIS_PUBLIC_VERSION_FIELDS = [
  "id",
  "ordinal",
  "isCurrent",
  "versionDoi",
  "conceptDoi",
] as const;
export const SYNTHESIS_PUBLIC_PRIVATE_FIELD_DENYLIST = [
  "draftId",
  "agentRunId",
  "requestKey",
  "idempotencyKey",
  "selector",
  "seriesKey",
  "generationKey",
  "packetJson",
  "prompt",
  "promptBytes",
  "providerRequest",
  "providerResponse",
  "rawOutput",
  "error",
  "stack",
  "rationale",
  "editorialNotes",
  "apiKey",
  "secret",
] as const;

const boundedId = z.string().trim().min(1).max(200);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const synthesisRegenerationProposalSchema = z
  .object({
    id: boundedId,
    revision: z.number().int().min(0).max(1_000_000_000),
    status: z.literal("open"),
    reviewSlug: z.string().trim().min(1).max(200),
    reviewTitle: z.string().trim().min(1).max(300),
    acceptedReviewVersionId: boundedId,
    evaluationKey: sha256,
    reasonCodes: z
      .array(synthesisStalenessReasonCodeSchema)
      .min(1)
      .max(SYNTHESIS_STALENESS_REASON_CODES.length),
    affectedReferences: z.array(synthesisStalenessAffectedReferenceSchema).max(100),
    affectedReferenceCount: z.number().int().min(0).max(SYNTHESIS_STALENESS_AFFECTED_REFERENCE_MAX),
    affectedReferencesTruncated: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((proposal, context) => {
    const expectedReasons = SYNTHESIS_STALENESS_REASON_CODES.filter((reason) =>
      proposal.reasonCodes.includes(reason),
    );
    if (
      expectedReasons.length !== proposal.reasonCodes.length ||
      expectedReasons.some((reason, index) => reason !== proposal.reasonCodes[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCodes"],
        message: "Proposal reason codes must be unique and canonically ordered.",
      });
    }
    if (
      proposal.affectedReferencesTruncated
        ? proposal.affectedReferenceCount <= proposal.affectedReferences.length
        : proposal.affectedReferenceCount !== proposal.affectedReferences.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affectedReferenceCount"],
        message: "Proposal affected-reference count must match its bounded summary.",
      });
    }
  });
export type SynthesisRegenerationProposal = z.infer<typeof synthesisRegenerationProposalSchema>;

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

const liveSynthesisDoiPairShape = {
  versionDoi: normalizedDoiSchema.optional(),
  conceptDoi: normalizedDoiSchema.optional(),
};

function validateLiveSynthesisDoiPair(
  value: { versionDoi?: string; conceptDoi?: string },
  context: z.RefinementCtx,
) {
  if (value.versionDoi && value.conceptDoi && value.versionDoi === value.conceptDoi) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["conceptDoi"],
      message: "Concept DOI must differ from version DOI.",
    });
  }
}

export const liveSynthesisDoiPairSchema = z
  .object(liveSynthesisDoiPairShape)
  .strict()
  .superRefine(validateLiveSynthesisDoiPair);

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

export function isSupportedSynthesisAcceptanceChecklist(version: string, value: unknown): boolean {
  switch (version) {
    case SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION:
      return synthesisAcceptanceChecklistSchema.safeParse(value).success;
    default:
      return false;
  }
}

export const synthesisDraftDecisionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        ...decisionBase,
        action: z.literal("accept"),
        licenseSpdx: synthesisSpdxExpressionSchema,
        rightsStatement: z.string().trim().min(10).max(2_000),
        ...liveSynthesisDoiPairShape,
        checklist: synthesisAcceptanceChecklistSchema,
      })
      .strict(),
    z.object({ ...decisionBase, action: z.literal("reject") }).strict(),
    z.object({ ...decisionBase, action: z.literal("request-regeneration") }).strict(),
  ])
  .superRefine((decision, context) => {
    if (decision.action === "accept") validateLiveSynthesisDoiPair(decision, context);
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

export function createPersistedSynthesisGenerationProvenanceSchema(
  attributionVersions: readonly [string, ...string[]],
  materializationVersions: readonly [string, ...string[]],
) {
  return synthesisGenerationProvenanceSchema
    .omit({ attributionPolicyVersion: true, materializationPolicyVersion: true })
    .extend({
      attributionPolicyVersion: z.enum(attributionVersions),
      materializationPolicyVersion: z.enum(materializationVersions),
    })
    .strict();
}

/** Persisted read schema uses append-only registries; new generation still uses current literals. */
export const persistedSynthesisGenerationProvenanceSchema =
  createPersistedSynthesisGenerationProvenanceSchema(
    SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS,
    SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS,
  );

export const acceptedSynthesisProvenanceSchema = persistedSynthesisGenerationProvenanceSchema
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
    licenseSpdx: synthesisSpdxExpressionSchema,
    checklistVersion: z.enum(SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS),
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
    provenance: persistedSynthesisGenerationProvenanceSchema,
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

export const publicSynthesisCitationSchema = z
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
  .strict();

export const publicSynthesisVersionBaseSchema = z
  .object({
    id: boundedId,
    ordinal: z.number().int().min(1),
    isCurrent: z.boolean(),
    ...liveSynthesisDoiPairShape,
  })
  .strict();
export const publicSynthesisVersionSchema = publicSynthesisVersionBaseSchema.superRefine(
  validateLiveSynthesisDoiPair,
);

/** Public synthesis DTO: deliberately no draft/run ids, packet/prompt bytes, keys, errors, or notes. */
export const publicSynthesisReviewSchema = z
  .object({
    slug: z.string().min(1).max(200),
    reviewType: z.literal("ai-synthesis"),
    title: z.string().min(1).max(300),
    abstract: z.string().min(1).max(2_000),
    document: synthesisReviewDocumentSchema,
    provenance: acceptedSynthesisProvenanceSchema,
    citations: z.array(publicSynthesisCitationSchema),
    version: publicSynthesisVersionSchema,
    freshness: synthesisFreshnessSchema,
  })
  .strict();
export type PublicSynthesisReview = z.infer<typeof publicSynthesisReviewSchema>;
