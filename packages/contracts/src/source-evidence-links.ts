import { z } from "zod";

/**
 * Source-native evidence links (issue #198, MVP Gate G4).
 *
 * A compatible review repository may declare a `provenance` sidecar next to its knowledge
 * artifacts. The ComputationalReviewTemplate S3 exporter writes one
 * (`comprev.oratlas-source-native-sidecar/1`) whose `evidence_links` bind a review citation to a
 * *producer finding* in an externally hosted Diggypaper source-evidence packet. These types
 * describe the consumed subset of that sidecar and the claim-scoped, read-only projection ORAtlas
 * derives from its preserved bytes.
 *
 * Boundaries this contract exists to keep:
 * - a producer finding is about a cited article; it is never a review claim;
 * - the packet is external: ORAtlas neither imports nor verifies its contents;
 * - the sidecar carries source-native Computational Review TRUST v2, which is not ORAtlas TRUST.
 */
export const SOURCE_NATIVE_SIDECAR_SCHEMA = "comprev.oratlas-source-native-sidecar/1";
export const SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION = "1.0.0";

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** One consumed `evidence_links[]` record. Unknown keys are tolerated and dropped. */
export const sidecarEvidenceLinkSchema = z.object({
  level: z.literal("producer_finding"),
  producer: z.literal("diggypaper"),
  packet_id: z.string().min(1).max(200),
  packet_sha256: sha256HexSchema,
  finding_id: z.string().min(1).max(200),
  finding_source_sha256: sha256HexSchema,
  cite_key: z.string().min(1).max(300),
  doi: z.string().min(1).max(300).nullable(),
  linked_review_claim_ids: z.array(z.string().min(1).max(300)).min(1).max(500),
});
export type SidecarEvidenceLink = z.infer<typeof sidecarEvidenceLinkSchema>;

export const sidecarNativeTrustSchema = z.object({
  origin: z.literal("source_native_trust"),
  rubric_version: z.string().min(1).max(40),
  overall_score: z.number().min(0).max(100).nullable(),
  trust_label: z.string().min(1).max(80),
  capped: z.boolean(),
});

export const sidecarClaimSchema = z.object({
  claim_id: z.string().min(1).max(300),
  claim_text_sha256: sha256HexSchema,
  trust_v2: sidecarNativeTrustSchema.optional(),
});

export const sourceNativeSidecarSchema = z.object({
  schema: z.literal(SOURCE_NATIVE_SIDECAR_SCHEMA),
  source_native_provenance: z.object({
    originating_repository: z.string().max(500),
    rubric_version: z.string().max(40),
    method_version: z.string().max(80),
    semantic_origin: z.literal("source_native_trust"),
    oratlas_re_adjudicated: z.literal(false),
  }),
  sources: z
    .object({
      claim_graph: z
        .object({ path: z.string().max(500), sha256: sha256HexSchema, bytes: z.number() })
        .optional(),
    })
    .passthrough(),
  claims: z.array(z.unknown()).max(50_000),
  evidence_links: z.array(z.unknown()).max(100_000),
});
export type SourceNativeSidecar = z.infer<typeof sourceNativeSidecarSchema>;

export const SOURCE_EVIDENCE_LINK_REJECTION_REASONS = [
  "invalid-link-record",
  "citation-not-in-review",
  "no-citation-relation",
  "doi-mismatch",
  "doi-unconfirmed",
  "ambiguous-source-relationship",
  "claim-text-digest-mismatch",
  "claim-graph-digest-mismatch",
  "claim-not-in-sidecar",
] as const;
export const sourceEvidenceLinkRejectionReasonSchema = z.enum(
  SOURCE_EVIDENCE_LINK_REJECTION_REASONS,
);
export type SourceEvidenceLinkRejectionReason = z.infer<
  typeof sourceEvidenceLinkRejectionReasonSchema
>;

export const sourceEvidenceLinksStatusSchema = z.enum([
  /** At least one link survived every check. */
  "linked",
  /** The sidecar was read and checked; no producer finding is linked to this claim. */
  "no-producer-finding",
  /** No `provenance` sidecar is declared or preserved for this version. */
  "sidecar-unavailable",
  /** The sidecar exists but is not parseable as a source-native sidecar. */
  "sidecar-invalid",
  /** The sidecar is bound to different claim text or a different claim graph than this version. */
  "sidecar-stale",
]);
export type SourceEvidenceLinksStatus = z.infer<typeof sourceEvidenceLinksStatusSchema>;

export const SOURCE_EVIDENCE_LABELS = {
  producer:
    "Producer finding: a statement about the cited article, recorded in an external Diggypaper evidence packet. It is not a claim of this review.",
  packet:
    "ORAtlas has not imported or verified the contents of this packet; the identifier and digest are the producer's declaration as carried by the review's sidecar.",
  passage:
    "Passage-level evidence (quote, match state, native support judgment) is not carried by the sidecar and is not shown here; resolve it in the external packet.",
  nativeAssessment:
    "Source-native Computational Review TRUST v2 as exported by the review repository. It is not an ORAtlas TRUST assessment, is not converted to one, and does not affect ORAtlas verification.",
} as const;

export const sourceEvidenceLinkedFindingSchema = z.object({
  findingId: z.string(),
  producer: z.literal("diggypaper"),
  packetId: z.string(),
  /** Producer-declared digest of the cited article's source snapshot, as carried by the sidecar. */
  sourceSnapshotSha256: sha256HexSchema,
  passageEvidence: z.literal("not-carried-by-sidecar"),
  producerAssessment: z.literal("not-carried-by-sidecar"),
});
export type SourceEvidenceLinkedFinding = z.infer<typeof sourceEvidenceLinkedFindingSchema>;

export const sourceEvidenceCitationSchema = z.object({
  citationLocalId: z.string(),
  doi: z.string().nullable(),
  doiIsExample: z.boolean(),
  /** The review's own claim→citation relation, from the accepted review version. */
  relation: z.object({
    relationType: z.string(),
    sourceLocation: z.string().nullable(),
  }),
  findings: z.array(sourceEvidenceLinkedFindingSchema),
});

export const sourceEvidencePacketSchema = z.object({
  packetId: z.string(),
  producer: z.literal("diggypaper"),
  packetSha256: sha256HexSchema,
  /** The sidecar declares no packet location, so none is shown; the packet is not retrievable here. */
  availability: z.literal("location-not-declared"),
  contentsImportedByOratlas: z.literal(false),
  contentsVerifiedByOratlas: z.literal(false),
});

export const sourceEvidenceRejectedLinkSchema = z.object({
  findingId: z.string().nullable(),
  citeKey: z.string().nullable(),
  reason: sourceEvidenceLinkRejectionReasonSchema,
});

export const sourceEvidenceNativeAssessmentSchema = z.object({
  protocol: z.literal("computational-review-trust"),
  rubricVersion: z.string(),
  origin: z.literal("source-native"),
  label: z.string(),
  /** Native 0–100 deterministic claim audit value; never an ORAtlas criterion or aggregate. */
  nativeOverallScore: z.number().nullable(),
  capped: z.boolean(),
  reAdjudicatedByOratlas: z.literal(false),
  isOratlasAssessment: z.literal(false),
});

export const sourceEvidenceLinksSchema = z.object({
  schemaVersion: z.literal(SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION),
  status: sourceEvidenceLinksStatusSchema,
  sidecar: z
    .object({
      path: z.string(),
      sha256: sha256HexSchema,
      bytes: z.number().int().nonnegative(),
    })
    .nullable(),
  packets: z.array(sourceEvidencePacketSchema),
  citations: z.array(sourceEvidenceCitationSchema),
  rejected: z.array(sourceEvidenceRejectedLinkSchema),
  nativeAssessment: sourceEvidenceNativeAssessmentSchema.nullable(),
  labels: z.object({
    producer: z.string(),
    packet: z.string(),
    passage: z.string(),
    nativeAssessment: z.string(),
  }),
});
export type SourceEvidenceLinks = z.infer<typeof sourceEvidenceLinksSchema>;
