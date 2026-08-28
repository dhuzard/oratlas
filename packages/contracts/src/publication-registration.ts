import { z } from "zod";
import {
  publicationHttpsUrlSchema,
  publicationSha256Schema,
  publicationStructuralProvenanceSchema,
  publicationTypeSchema,
  publicationCaptureArtifactKindSchema,
  sourceLocalPublicationIdSchema,
  MYST_PUBLICATION_PROTOCOL_VERSION,
  publicationAdapterTypeSchema,
  publicationClaimDeclarationAuthoritySchema,
  sourceLocalClaimIdSchema,
} from "./publications.js";
import { safeRepoRelativePathSchema } from "./paths.js";

/**
 * Registration of an externally hosted publication.
 *
 * Registration is the operation that turns "ORAtlas does not host the
 * publication" from a description into something operational: an operator
 * gives ORAtlas a manifest URL, ORAtlas retrieves it through its hardened
 * outbound boundary, retains exactly the bytes it saw, validates them
 * fail-closed against the pinned producer contract, and materializes generic
 * publication records.
 *
 * Three things this contract deliberately does **not** express:
 *
 * 1. **Ownership.** Registering a URL is not a claim to own the publication
 *    it names. There is no ownership proof in this contract and no boolean
 *    pretending to be one; see `docs/external-publications.md`.
 * 2. **Scientific standing.** `structuralProvenance` says what ORAtlas
 *    structurally checked. It is never a verification, confirmation or peer
 *    review of anything.
 * 3. **Canonical graph identity.** A registration produces source
 *    occurrences. Binding one to a canonical claim is a separate, explicit,
 *    reviewed decision.
 */

/** Contract version of the registration request and result. */
export const PUBLICATION_REGISTRATION_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Protocol schema versions ORAtlas implements. A manifest declaring anything
 * else is rejected outright: partially interpreting a future manifest is worse
 * than refusing it.
 */
export const SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS = [MYST_PUBLICATION_PROTOCOL_VERSION] as const;

/**
 * Why a registration failed. Every code is safe to return to a caller: none of
 * them reveals ORAtlas's network, its resolver, or an internal address.
 */
export const PUBLICATION_REGISTRATION_ERROR_CODES = [
  /** The submitted URL is not an acceptable outbound destination. */
  "manifest-url-rejected",
  /** The manifest could not be retrieved within the operation's limits. */
  "manifest-unreachable",
  /** The manifest bytes are not UTF-8 JSON. */
  "manifest-invalid-json",
  /** The manifest declares a schema version ORAtlas does not implement. */
  "manifest-schema-unsupported",
  /** The manifest is not a valid document of a version ORAtlas implements. */
  "manifest-invalid",
  /** The manifest declares an adapter or target variant ORAtlas cannot read. */
  "adapter-not-supported",
  /** A declared path failed the safe-path rule and was never resolved. */
  "artifact-path-unsafe",
  /** A declared artifact could not be retrieved within the operation's limits. */
  "artifact-unreachable",
  /** A declared artifact digest disagrees with the observed bytes. */
  "artifact-digest-mismatch",
  /** The declared record count disagrees with the artifact actually read. */
  "artifact-record-count-mismatch",
  /** The artifact is not well-formed for its declared format. */
  "artifact-malformed",
  /** A claim record is not a valid record of the pinned protocol version. */
  "claim-record-invalid",
  /** One source-local claim id is declared more than once in one version. */
  "duplicate-source-local-claim-id",
  /** A declared claim target does not resolve in the publication's inventory. */
  "cross-reference-target-missing",
  /** The publication's cross-reference inventory is unreadable or too large. */
  "cross-reference-inventory-invalid",
  /** The page the inventory points at does not structurally contain the claim. */
  "page-data-claim-node-missing",
  /** Two artifacts claim authority over the same declarations. */
  "declaration-authority-conflict",
  /** Obtained source bytes disagree with what the publication declared. */
  "source-verification-mismatch",
  /** A declared count, size or artifact exceeds a registration limit. */
  "limit-exceeded",
  /** The publication declares no evidence ORAtlas can key an identity from. */
  "publication-identity-insufficient",
  /** The same observation is being captured concurrently; retry. */
  "observation-already-in-flight",
] as const;
export const publicationRegistrationErrorCodeSchema = z.enum(PUBLICATION_REGISTRATION_ERROR_CODES);
export type PublicationRegistrationErrorCode = z.infer<
  typeof publicationRegistrationErrorCodeSchema
>;

/**
 * Non-fatal observations about a registration. A warning never changes the
 * structural provenance level reached; it records something an operator should
 * know about the publication as observed.
 */
export const PUBLICATION_REGISTRATION_WARNING_CODES = [
  /** The declared canonical URL is not the location ORAtlas observed. */
  "canonical-url-differs-from-observed-location",
  /** The publication declares no canonical URL, so published links use the observed root. */
  "canonical-url-not-declared",
  /** An inventory entry names no page data, so no page-level check was possible. */
  "cross-reference-entry-declares-no-page-data",
  /** The publication declares a review manifest ORAtlas retained but did not interpret. */
  "review-manifest-captured-not-interpreted",
  /** Source-byte verification was not reached; the reason is recorded separately. */
  "source-byte-verification-not-reached",
  /** The publication declares no claims at all. */
  "publication-declares-no-claims",
] as const;
export const publicationRegistrationWarningCodeSchema = z.enum(
  PUBLICATION_REGISTRATION_WARNING_CODES,
);
export type PublicationRegistrationWarningCode = z.infer<
  typeof publicationRegistrationWarningCodeSchema
>;

export const publicationRegistrationWarningSchema = z
  .object({
    code: publicationRegistrationWarningCodeSchema,
    message: z.string().min(1).max(500),
  })
  .strict();
export type PublicationRegistrationWarning = z.infer<typeof publicationRegistrationWarningSchema>;

/**
 * Why source-byte verification was not reached. Recorded explicitly so a
 * publication limited to `published-structure` never looks as though its
 * source bytes had simply been checked and passed.
 */
export const PUBLICATION_SOURCE_UNAVAILABLE_REASONS = [
  /** The publication declares no source descriptor at all. */
  "no-source-declared",
  /** ORAtlas implements no exact-byte resolver for the declared source type. */
  "source-type-not-supported",
  /** A git source without a pinned commit cannot identify exact bytes. */
  "source-commit-not-declared",
  /** The declared repository is not one ORAtlas can read exact bytes from. */
  "source-repository-not-supported",
  /** The source is declared and supported, but a document could not be read. */
  "source-document-unavailable",
  /** The declaration digest cannot be recomputed from the published selector. */
  "source-declaration-not-recomputable",
  /** This deployment has no source resolver configured. */
  "no-source-resolver-configured",
] as const;
export const publicationSourceUnavailableReasonSchema = z.enum(
  PUBLICATION_SOURCE_UNAVAILABLE_REASONS,
);
export type PublicationSourceUnavailableReason = z.infer<
  typeof publicationSourceUnavailableReasonSchema
>;

/**
 * The outcome of the source-byte attempt, always present.
 *
 * A result must state which level it reached, and a source fetch failure must
 * never silently look like a publication that simply had no source: the
 * `unavailable` variant carries the reason it was not reached.
 */
export const publicationSourceVerificationSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("reached"),
      sourceType: z.enum(["git", "doi", "archive"]),
      /** Which exact-byte resolver obtained the source. Audit metadata. */
      resolver: z.string().min(1).max(120),
      documentsChecked: z.number().int().nonnegative().max(1_000_000),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      reason: publicationSourceUnavailableReasonSchema,
      sourceType: z.enum(["git", "doi", "archive"]).optional(),
    })
    .strict(),
]);
export type PublicationSourceVerification = z.infer<typeof publicationSourceVerificationSchema>;

/** One redirect hop, retained so a capture's route is auditable. */
export const publicationHttpRedirectSchema = z
  .object({
    from: z.string().min(1).max(2_000),
    to: z.string().min(1).max(2_000),
    status: z.number().int().min(300).max(399),
  })
  .strict();

/**
 * HTTP provenance for one retrieved artifact: enough to audit what ORAtlas
 * asked for, where it was finally served from, and how it got there.
 */
export const publicationHttpProvenanceSchema = z
  .object({
    requestedUrl: z.string().min(1).max(2_000),
    finalUrl: z.string().min(1).max(2_000),
    status: z.number().int().min(100).max(599),
    mediaType: z.string().max(120),
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    redirects: z.array(publicationHttpRedirectSchema).max(20),
    retrievedAt: z.string().datetime(),
  })
  .strict();
export type PublicationHttpProvenance = z.infer<typeof publicationHttpProvenanceSchema>;

/** One artifact as it appears in a registration result. Bytes are not returned. */
export const publicationRegistrationArtifactSchema = z
  .object({
    kind: publicationCaptureArtifactKindSchema,
    declaredPath: safeRepoRelativePathSchema.optional(),
    observedUrl: z.string().min(1).max(2_000),
    mediaType: z.string().max(120),
    /** Digest ORAtlas recomputed over the exact observed bytes. */
    contentSha256: publicationSha256Schema,
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Digest the publication declared, when it declared one. */
    declaredSha256: publicationSha256Schema.optional(),
  })
  .strict();
export type PublicationRegistrationArtifact = z.infer<typeof publicationRegistrationArtifactSchema>;

/** The registration request. Deliberately tiny: a URL, and how to file it. */
export const publicationRegistrationRequestSchema = z
  .object({
    /**
     * Absolute https URL of the publication's `oratlas.manifest.json`.
     * Untrusted: it is admitted by the outbound URL policy before use.
     */
    manifestUrl: z.string().min(1).max(2_000),
    /**
     * What kind of scholarly object this is. The 0.2.0 producer contract
     * declares no publication type, so ORAtlas does not infer one: it records
     * `other` unless an operator states it, and an editor may correct it later.
     */
    publicationType: publicationTypeSchema.optional(),
  })
  .strict();
export type PublicationRegistrationRequest = z.infer<typeof publicationRegistrationRequestSchema>;

/**
 * Whether this call observed something new or replayed an identical
 * observation. Idempotency is deterministic: the same manifest URL yielding
 * byte-identical artifacts replays its existing capture instead of creating a
 * second one. Different bytes always create a new capture — a capture is never
 * overwritten.
 */
export const publicationRegistrationDispositionSchema = z.enum([
  "captured",
  "replayed",
  "new-version-captured",
]);
export type PublicationRegistrationDisposition = z.infer<
  typeof publicationRegistrationDispositionSchema
>;

export const publicationRegistrationResultSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_REGISTRATION_SCHEMA_VERSION),
    disposition: publicationRegistrationDispositionSchema,
    registration: z
      .object({
        id: z.string().min(1).max(200),
        manifestUrl: z.string().min(1).max(2_000),
      })
      .strict(),
    capture: z
      .object({
        id: z.string().min(1).max(200),
        /** Deterministic digest over the observation, used for idempotency. */
        captureKey: publicationSha256Schema,
        requestedManifestUrl: z.string().min(1).max(2_000),
        resolvedManifestUrl: z.string().min(1).max(2_000),
        manifestSha256: publicationSha256Schema,
        capturedAt: z.string().datetime(),
        manifestProvenance: publicationHttpProvenanceSchema,
        artifacts: z.array(publicationRegistrationArtifactSchema).min(1).max(16),
      })
      .strict(),
    publication: z
      .object({
        id: z.string().min(1).max(200),
        stableKey: z.string().min(1).max(500),
        publicationType: publicationTypeSchema,
        sourceLocalPublicationId: sourceLocalPublicationIdSchema.optional(),
      })
      .strict(),
    publicationVersion: z
      .object({
        id: z.string().min(1).max(200),
        stableKey: z.string().min(1).max(500),
        sourcesSha256: publicationSha256Schema,
        versionLabel: z.string().min(1).max(120).optional(),
        title: z.string().min(1).max(500).optional(),
        canonicalUrl: publicationHttpsUrlSchema.optional(),
      })
      .strict(),
    manifestSchemaVersion: z.enum(SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS),
    adapterType: publicationAdapterTypeSchema,
    /** Number of source occurrences materialized for this version. */
    claimOccurrenceCount: z.number().int().nonnegative().max(1_000_000),
    /** The level actually reached. Structural only; never scientific standing. */
    structuralProvenance: publicationStructuralProvenanceSchema,
    sourceVerification: publicationSourceVerificationSchema,
    warnings: z.array(publicationRegistrationWarningSchema).max(200),
    /** Canonical ORAtlas locations for what the registration produced. */
    links: z
      .object({
        publication: z.string().min(1).max(2_000),
        publicationVersion: z.string().min(1).max(2_000),
        capture: z.string().min(1).max(2_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.structuralProvenance === "source-byte" &&
      result.sourceVerification.outcome !== "reached"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source-byte provenance requires a reached source verification outcome.",
        path: ["structuralProvenance"],
      });
    }
    if (
      result.structuralProvenance === "published-structure" &&
      result.sourceVerification.outcome === "reached"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reached source verification must be reported as source-byte provenance.",
        path: ["structuralProvenance"],
      });
    }
  });
export type PublicationRegistrationResult = z.infer<typeof publicationRegistrationResultSchema>;

/**
 * Public read models for what a registration produced.
 *
 * These are addressing and provenance documents. They deliberately carry no
 * assessment, no TRUST value, no editorial status and no canonical graph
 * identity: a source occurrence is not a canonical claim, and nothing here may
 * be read as one.
 *
 * Retained capture *bytes* are deliberately not part of any response. The
 * digests, the byte lengths and the HTTP provenance are what an audit needs;
 * re-serving untrusted external content through ORAtlas's own API is an
 * avoidable surface, and the bytes stay in the capture record.
 */
export const publicationVersionSummarySchema = z
  .object({
    id: z.string().min(1).max(200),
    stableKey: z.string().min(1).max(500),
    sourcesSha256: publicationSha256Schema,
    versionLabel: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(500).optional(),
    canonicalUrl: publicationHttpsUrlSchema.optional(),
    adapterType: publicationAdapterTypeSchema,
    structuralProvenance: publicationStructuralProvenanceSchema,
    /** Wording that never says verified, trustworthy, confirmed or peer reviewed. */
    structuralProvenanceDescription: z.string().min(1).max(300),
    observedAt: z.string().datetime(),
    claimOccurrenceCount: z.number().int().nonnegative().max(1_000_000),
    links: z.object({ self: z.string().min(1).max(2_000) }).strict(),
  })
  .strict();
export type PublicationVersionSummary = z.infer<typeof publicationVersionSummarySchema>;

export const publicationResourceSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_REGISTRATION_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    stableKey: z.string().min(1).max(500),
    publicationType: publicationTypeSchema,
    recordSource: z.enum(["external-publication", "atlas-review-projection"]),
    sourceLocalPublicationId: sourceLocalPublicationIdSchema.optional(),
    /** Which durable evidence ORAtlas keyed this publication from. */
    identityEvidenceBasis: z.enum([
      "git-source",
      "concept-doi",
      "declared-identifier",
      "registration",
      "atlas-review",
    ]),
    versions: z.array(publicationVersionSummarySchema).max(500),
    links: z.object({ self: z.string().min(1).max(2_000) }).strict(),
  })
  .strict();
export type PublicationResource = z.infer<typeof publicationResourceSchema>;

export const publicationClaimOccurrenceViewSchema = z
  .object({
    id: z.string().min(1).max(200),
    stableKey: z.string().min(1).max(500),
    sourceLocalClaimId: sourceLocalClaimIdSchema,
    targetIdentifier: sourceLocalClaimIdSchema,
    declarationAuthority: publicationClaimDeclarationAuthoritySchema,
    declarationSha256: publicationSha256Schema,
    text: z.string().min(1).max(5_000).optional(),
    claimType: z.string().min(1).max(60).optional(),
    qualification: z.string().min(1).max(2_000).optional(),
    sourceDocumentPath: safeRepoRelativePathSchema,
    sourceDocumentSha256: publicationSha256Schema,
    /**
     * Always null in this phase. A canonical binding is an explicit, reviewed
     * decision and is never inferred from an occurrence.
     */
    canonicalKnowledgeNodeId: z.null(),
  })
  .strict();

export const publicationCaptureViewSchema = z
  .object({
    id: z.string().min(1).max(200),
    artifactKind: publicationCaptureArtifactKindSchema,
    declaredPath: safeRepoRelativePathSchema.optional(),
    observedUrl: z.string().min(1).max(2_000).optional(),
    mediaType: z.string().max(120),
    contentSha256: publicationSha256Schema,
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    declaredSha256: publicationSha256Schema.optional(),
    capturedAt: z.string().datetime(),
  })
  .strict();

export const publicationVersionResourceSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_REGISTRATION_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    stableKey: z.string().min(1).max(500),
    publicationId: z.string().min(1).max(200),
    publicationStableKey: z.string().min(1).max(500),
    sourcesSha256: publicationSha256Schema,
    versionLabel: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(500).optional(),
    canonicalUrl: publicationHttpsUrlSchema.optional(),
    adapterType: publicationAdapterTypeSchema,
    protocolVersion: z.enum(SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS),
    structuralProvenance: publicationStructuralProvenanceSchema,
    structuralProvenanceDescription: z.string().min(1).max(300),
    observedAt: z.string().datetime(),
    claimOccurrences: z.array(publicationClaimOccurrenceViewSchema).max(5_000),
    captures: z.array(publicationCaptureViewSchema).max(64),
    links: z
      .object({
        self: z.string().min(1).max(2_000),
        publication: z.string().min(1).max(2_000),
      })
      .strict(),
  })
  .strict();
export type PublicationVersionResource = z.infer<typeof publicationVersionResourceSchema>;

export const publicationRegistrationCaptureResourceSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_REGISTRATION_SCHEMA_VERSION),
    id: z.string().min(1).max(200),
    captureKey: publicationSha256Schema,
    registration: z
      .object({
        id: z.string().min(1).max(200),
        manifestUrl: z.string().min(1).max(2_000),
      })
      .strict(),
    requestedManifestUrl: z.string().min(1).max(2_000),
    resolvedManifestUrl: z.string().min(1).max(2_000),
    observedSiteRootUrl: z.string().min(1).max(2_000),
    manifestSha256: publicationSha256Schema,
    manifestProvenance: publicationHttpProvenanceSchema,
    declaredSchemaVersion: z.enum(SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS),
    adapterType: publicationAdapterTypeSchema,
    sourceLocalPublicationId: sourceLocalPublicationIdSchema.optional(),
    sourcesSha256: publicationSha256Schema,
    structuralProvenance: publicationStructuralProvenanceSchema,
    sourceVerification: publicationSourceVerificationSchema,
    warnings: z.array(publicationRegistrationWarningSchema).max(200),
    capturedAt: z.string().datetime(),
    artifacts: z.array(publicationCaptureViewSchema).max(64),
    links: z
      .object({
        publication: z.string().min(1).max(2_000).optional(),
        publicationVersion: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
  })
  .strict();
export type PublicationRegistrationCaptureResource = z.infer<
  typeof publicationRegistrationCaptureResourceSchema
>;
