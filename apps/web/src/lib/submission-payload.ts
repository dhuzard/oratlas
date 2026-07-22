import "server-only";
import {
  canonicalJson,
  claimRecordSchema,
  citationRecordSchema,
  compatibilityLevelSchema,
  compatibilityReportSchema,
  effectiveMetadataSchema,
  relationRecordSchema,
  submissionValidationReportSchema,
  sourceAssessmentDocumentsReportSchema,
  trustAssessmentRecordSchema,
  type ClaimRecord,
  type CitationRecord,
  type CompatibilityReport,
  type EffectiveMetadata,
  type RelationRecord,
  type SubmissionValidationReport,
  type TrustAssessmentRecord,
  type SourceAssessmentDocumentsReport,
} from "@oratlas/contracts";
import {
  createEmptyNodeExtractionReport,
  nodeExtractionReportSchema,
  type ExtractedNodeRecord,
  type NodeExtractionReport,
} from "@oratlas/extractor";
import { z } from "zod";

export interface PublicationTargets {
  proseReview: boolean;
  knowledgeNodes: boolean;
}

export interface SubmissionPayload {
  schemaVersion: "1.0.0" | "1.1.0";
  capturePayloadHash: string;
  effectiveMetadata: EffectiveMetadata;
  compatibilityLevel: string;
  compatibilityReport: CompatibilityReport;
  validation: SubmissionValidationReport;
  knowledge: {
    claims: ClaimRecord[];
    citations: CitationRecord[];
    relations: RelationRecord[];
    trust: TrustAssessmentRecord[];
    warnings: string[];
  };
  nodeExtraction: NodeExtractionReport;
  publicationTargets: PublicationTargets;
  sourceAssessmentDocuments?: SourceAssessmentDocumentsReport;
}

export type NodeCandidateRecord = ExtractedNodeRecord & {
  status: "ok";
  node: NonNullable<ExtractedNodeRecord["node"]>;
};

const knowledgeSchema = z
  .object({
    claims: z.array(claimRecordSchema),
    citations: z.array(citationRecordSchema),
    relations: z.array(relationRecordSchema),
    trust: z.array(trustAssessmentRecordSchema),
    warnings: z.array(z.string()),
  })
  .strict();

const payloadFields = {
  capturePayloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  effectiveMetadata: effectiveMetadataSchema,
  compatibilityLevel: compatibilityLevelSchema,
  compatibilityReport: compatibilityReportSchema,
  validation: submissionValidationReportSchema,
  knowledge: knowledgeSchema,
  sourceAssessmentDocuments: sourceAssessmentDocumentsReportSchema.optional(),
};

const submissionPayloadSchema = z.discriminatedUnion("schemaVersion", [
  z.object({ schemaVersion: z.literal("1.0.0"), ...payloadFields }).strict(),
  z
    .object({
      schemaVersion: z.literal("1.1.0"),
      ...payloadFields,
      nodeExtraction: nodeExtractionReportSchema,
      publicationTargets: z
        .object({ proseReview: z.boolean(), knowledgeNodes: z.boolean() })
        .strict(),
    })
    .strict(),
]);

export function parseStoredSubmissionPayload(payloadJson: string | null): SubmissionPayload | null {
  if (!payloadJson) return null;
  try {
    const value: unknown = JSON.parse(payloadJson);
    if (canonicalJson(value) !== payloadJson) return null;
    const parsed = submissionPayloadSchema.safeParse(value);
    if (!parsed.success) return null;
    if (parsed.data.schemaVersion === "1.1.0") return parsed.data as SubmissionPayload;
    return {
      ...parsed.data,
      nodeExtraction: createEmptyNodeExtractionReport(),
      publicationTargets: { proseReview: true, knowledgeNodes: false },
    } as SubmissionPayload;
  } catch {
    return null;
  }
}

export function validNodeCandidates(payload: SubmissionPayload): NodeCandidateRecord[] {
  return payload.nodeExtraction.nodes.filter(
    (record): record is NodeCandidateRecord => record.status === "ok" && Boolean(record.node),
  );
}

export function derivePublicationTargets(
  compatibilityReviewDetected: boolean,
  manifestPresent: boolean,
  legacyClaimCount: number,
  legacyCitationCount: number,
  validNodeCount: number,
): PublicationTargets {
  const proseSignals =
    compatibilityReviewDetected ||
    manifestPresent ||
    legacyClaimCount > 0 ||
    legacyCitationCount > 0;
  return {
    proseReview: proseSignals || validNodeCount === 0,
    knowledgeNodes: validNodeCount > 0,
  };
}
