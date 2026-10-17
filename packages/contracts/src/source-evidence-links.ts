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

/**
 * Where the exact external packet can be fetched, as declared by the producer. Only a DOI (for
 * example a Zenodo deposit) or a GitHub release asset is accepted. The packet digest, not the
 * locator, decides authenticity.
 */
export const GITHUB_RELEASE_ASSET_URL =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^/\s?#]+\/[^/\s?#]+$/;
export const sidecarPacketLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("doi"),
    doi: z
      .string()
      .regex(/^10\.\d{4,9}\/\S+$/)
      .max(300),
  }),
  z.object({
    kind: z.literal("github-release-asset"),
    url: z.string().max(500).regex(GITHUB_RELEASE_ASSET_URL),
  }),
]);
export type SidecarPacketLocator = z.infer<typeof sidecarPacketLocatorSchema>;

const taggedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const PACKET_VERIFICATION_LEVELS = [
  "unverified",
  "human-reviewed",
  "source-verified",
  "independently-verified",
] as const;
export const PACKET_MATCH_STATUSES = [
  "exact",
  "normalized",
  "not_found",
  "ambiguous",
  "invalid",
  "source_unavailable",
  "not_checked",
  "incomplete",
] as const;

export const sidecarPassageSchema = z.object({
  passage_id: z.string().min(1).max(200),
  quote_sha256: taggedSha256Schema,
  quote_state: z.enum(["included", "withheld-rights"]),
  match_status: z.enum(PACKET_MATCH_STATUSES),
});
export const sidecarAssessmentSchema = z.object({
  assessment_id: z.string().min(1).max(200),
  protocol: z.literal("seip-support-v1"),
  status: z.string().min(1).max(60),
});

/** One recorded decision that a review claim uses a specific finding revision. */
export const sidecarClaimMappingSchema = z.object({
  claim_id: z.string().min(1).max(300),
  decision_ref: z.string().trim().min(1).max(300),
  asserted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
  basis: z.string().trim().min(1).max(2_000),
});

/**
 * One consumed `evidence_links[]` record. Unknown keys are tolerated and dropped. The passage-level
 * fields exist only in `comprev.evidence-packet-links/2` exports; a `/1` record is still valid and
 * is projected with those fields explicitly marked as not carried.
 */
export const sidecarEvidenceLinkSchema = z
  .object({
    level: z.literal("producer_finding"),
    producer: z.literal("diggypaper"),
    packet_id: z.string().min(1).max(200),
    packet_sha256: sha256HexSchema,
    packet_locator: sidecarPacketLocatorSchema.nullable().optional(),
    finding_id: z.string().min(1).max(200),
    finding_revision: z.number().int().min(1).optional(),
    finding_source_sha256: sha256HexSchema,
    cite_key: z.string().min(1).max(300),
    doi: z.string().min(1).max(300).nullable(),
    linked_review_claim_ids: z.array(z.string().min(1).max(300)).min(1).max(500),
    verification_level: z.enum(PACKET_VERIFICATION_LEVELS).optional(),
    passages: z.array(sidecarPassageSchema).min(1).max(200).optional(),
    assessments: z.array(sidecarAssessmentSchema).max(200).optional(),
    binding: z.enum(["reviewed-mapping", "same-paper-candidate"]).optional(),
    phase2_finding_sha256: taggedSha256Schema.optional(),
    mappings: z.array(sidecarClaimMappingSchema).min(1).max(500).optional(),
  })
  .superRefine((link, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    const declared = [
      link.finding_revision,
      link.verification_level,
      link.passages,
      link.binding,
    ].filter((value) => value !== undefined).length;
    if (declared !== 0 && declared !== 4) {
      issue("Passage-level fields and binding must be declared together or not at all.");
    }
    if (link.binding === "reviewed-mapping") {
      const mapped = (link.mappings ?? []).map((mapping) => mapping.claim_id).sort();
      const claims = [...link.linked_review_claim_ids].sort();
      if (!link.phase2_finding_sha256 || JSON.stringify(mapped) !== JSON.stringify(claims)) {
        issue("A reviewed mapping needs a Phase 2 digest and one mapping per linked claim.");
      }
    } else if (link.mappings !== undefined || link.phase2_finding_sha256 !== undefined) {
      issue("Only a reviewed mapping may carry mappings or a Phase 2 digest.");
    }
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
      trust_score_report: z
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
  "claim-record-conflict",
] as const;
export const sourceEvidenceLinkRejectionReasonSchema = z.enum(
  SOURCE_EVIDENCE_LINK_REJECTION_REASONS,
);
export type SourceEvidenceLinkRejectionReason = z.infer<
  typeof sourceEvidenceLinkRejectionReasonSchema
>;

export const sourceEvidenceLinksStatusSchema = z.enum([
  /** At least one finding is bound to this claim by a reviewed mapping and survived every check. */
  "linked",
  /** Only same-paper candidates survived: findings about a cited paper, not evidence for this claim. */
  "candidates-only",
  /** The sidecar was read and checked; no producer finding is linked to this claim. */
  "no-producer-finding",
  /** No `provenance` sidecar is declared or preserved for this version. */
  "sidecar-unavailable",
  /** The sidecar is unparseable, malformed, or holds conflicting records for this claim. */
  "sidecar-invalid",
  /** The sidecar is bound to different claim text or a different claim graph than this version. */
  "sidecar-stale",
]);
export type SourceEvidenceLinksStatus = z.infer<typeof sourceEvidenceLinksStatusSchema>;

export const SOURCE_EVIDENCE_LABELS = {
  producer:
    "Producer finding: a statement about the cited article, recorded in an external Diggypaper evidence packet. It is not a claim of this review.",
  packet:
    "ORAtlas has not imported or verified the contents of this packet; the identifier, digest and location are the producer's declaration as carried by the review's sidecar.",
  passage:
    "Passage digests, match states and native support judgments, where shown, are the producer's declaration in the sidecar. Quote text is never shown. To check a digest, fetch the packet from its declared location and hash it; ORAtlas has not.",
  candidate:
    "Same-paper candidate: a finding about a paper this claim cites. No reviewed decision says this claim uses it, so it is not shown as evidence for the claim.",
  nativeAssessment:
    "Source-native Computational Review TRUST v2 as exported by the review repository. It is not an ORAtlas TRUST assessment, is not converted to one, and does not affect ORAtlas verification.",
  nativeAssessmentUnverified:
    "ORAtlas could not recheck this value against the review's frozen claim graph and TRUST report, because they were not preserved with this version. Treat it as an unverified source declaration.",
} as const;

export const sourceEvidenceLinkedFindingSchema = z.object({
  findingId: z.string(),
  /**
   * `reviewed-mapping`: a recorded decision says this claim uses this finding revision.
   * `same-paper-candidate`: only the cited paper is shared. `binding-not-declared`: a links/1
   * sidecar, which cannot say; treated as a candidate.
   */
  binding: z.enum(["reviewed-mapping", "same-paper-candidate", "binding-not-declared"]),
  phase2FindingSha256: taggedSha256Schema.nullable(),
  /** The decision for this claim; null unless `binding` is `reviewed-mapping`. */
  mapping: z
    .object({ decisionRef: z.string(), assertedAt: z.string(), basis: z.string() })
    .nullable(),
  producer: z.literal("diggypaper"),
  packetId: z.string(),
  /** Producer-declared digest of the cited article's source snapshot, as carried by the sidecar. */
  sourceSnapshotSha256: sha256HexSchema,
  /** Null when the sidecar predates `comprev.evidence-packet-links/2`. */
  revision: z.number().int().min(1).nullable(),
  verificationLevel: z.enum(PACKET_VERIFICATION_LEVELS).nullable(),
  /**
   * `declared-by-sidecar`: passage digests and match state are the producer's declaration; quote
   * text is never carried. `not-carried-by-sidecar`: the sidecar has no passage data.
   */
  passageEvidence: z.enum(["declared-by-sidecar", "not-carried-by-sidecar"]),
  passages: z
    .array(
      z.object({
        passageId: z.string(),
        quoteSha256: taggedSha256Schema,
        quoteState: z.enum(["included", "withheld-rights"]),
        matchStatus: z.enum(PACKET_MATCH_STATUSES),
      }),
    )
    .nullable(),
  /** Native Diggypaper `seip-support-v1` judgments; never an ORAtlas assessment. */
  producerAssessment: z.enum(["declared-by-sidecar", "not-carried-by-sidecar"]),
  assessments: z
    .array(
      z.object({
        assessmentId: z.string(),
        protocol: z.literal("seip-support-v1"),
        status: z.string(),
      }),
    )
    .nullable(),
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
  /** Findings bound to this claim by a reviewed mapping. */
  findings: z.array(sourceEvidenceLinkedFindingSchema),
  /** Same-paper candidates, kept separate and never presented as this claim's evidence. */
  candidateFindings: z.array(sourceEvidenceLinkedFindingSchema),
});

export const sourceEvidencePacketSchema = z.object({
  packetId: z.string(),
  producer: z.literal("diggypaper"),
  packetSha256: sha256HexSchema,
  /**
   * The producer's declared location, if any. `href` is set only where it is safe to link: never for
   * an example DOI.
   */
  locator: z
    .object({
      kind: z.enum(["doi", "github-release-asset"]),
      doi: z.string().nullable(),
      url: z.string().nullable(),
      href: z.string().nullable(),
      doiIsExample: z.boolean(),
    })
    .nullable(),
  availability: z.enum(["locator-declared", "location-not-declared"]),
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
  /**
   * Whether ORAtlas rechecked the sidecar's recorded digests of the native source files against the
   * bytes preserved with this version. A mismatch withholds the value entirely.
   */
  provenance: z.object({
    claimGraph: z.enum(["digest-matched", "not-preserved", "not-declared"]),
    trustScoreReport: z.enum(["digest-matched", "not-preserved", "not-declared"]),
  }),
  verifiedAgainstPreservedSources: z.boolean(),
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
  /** Why `nativeAssessment` is null, when the sidecar carries one. */
  nativeAssessmentWithheld: z.enum(["sidecar-stale", "trust-report-digest-mismatch"]).nullable(),
  labels: z.object({
    producer: z.string(),
    packet: z.string(),
    passage: z.string(),
    candidate: z.string(),
    nativeAssessment: z.string(),
    nativeAssessmentUnverified: z.string(),
  }),
});
export type SourceEvidenceLinks = z.infer<typeof sourceEvidenceLinksSchema>;
