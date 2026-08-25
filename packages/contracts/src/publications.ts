import { z } from "zod";
import { claimTypeSchema } from "./enums.js";
import {
  textPositionSelectorSchema,
  textQuoteSelectorSchema,
  unicodeCodePointLength,
} from "./comments.js";
import { commitShaSchema, doiSchema } from "./identifiers.js";
import { safeRepoRelativePathSchema } from "./paths.js";
import { publicationAdapterTypeSchema } from "./publication-adapters.js";

/**
 * The generic publication boundary.
 *
 * ORAtlas archives reviews it ingests from GitHub repositories, but a review is
 * only one *type* of publication. An independently hosted publication — a MyST
 * site, a journal article, a preprint — publishes its own machine-readable
 * declarations and never contacts ORAtlas to do so. These contracts describe
 * what ORAtlas observes about such a publication.
 *
 * Three separations are load-bearing and must survive every later phase:
 *
 * 1. **Publication identity is not version identity.** A publication persists
 *    across versions; one exact observed version is identified by the digest
 *    over its source documents, never by a URL.
 * 2. **Source occurrence is not canonical identity.** A claim occurrence says
 *    "this declaration appears here, in this exact version". It never says two
 *    occurrences are the same canonical claim. Equal text, equal source-local
 *    id and equal `declarationSha256` are all explicitly non-identities.
 * 3. **Structural provenance is not scientific validation.** See
 *    {@link PUBLICATION_STRUCTURAL_PROVENANCE_LEVELS}.
 *
 * Nothing here is toolchain-specific. Adapter and target metadata are closed,
 * versioned discriminated unions, so a JATS or Quarto adapter is a new variant
 * rather than a change to the generic boundary.
 */

/** Contract version of the generic publication boundary itself. */
export const PUBLICATION_BOUNDARY_SCHEMA_VERSION = "1.0.0" as const;

/**
 * What kind of scholarly object a publication is. `review-article` is the type
 * that existing ORAtlas `Review` records project into; it is a member of this
 * list, not a synonym for it.
 *
 * Append-only: a new type must never change canonical graph identity.
 */
export const PUBLICATION_TYPES = [
  "review-article",
  "research-article",
  "methods-article",
  "preprint",
  "living-review",
  "other",
] as const;
export const publicationTypeSchema = z.enum(PUBLICATION_TYPES);
export type PublicationType = z.infer<typeof publicationTypeSchema>;

/**
 * Where a publication record came from.
 *
 * - `external-publication` — a natively registered, independently hosted
 *   publication. ORAtlas observes it; it does not host it.
 * - `atlas-review-projection` — a projection of a legacy ORAtlas `Review` into
 *   the generic boundary. The review storage remains authoritative.
 */
export const PUBLICATION_RECORD_SOURCES = [
  "external-publication",
  "atlas-review-projection",
] as const;
export const publicationRecordSourceSchema = z.enum(PUBLICATION_RECORD_SOURCES);
export type PublicationRecordSource = z.infer<typeof publicationRecordSourceSchema>;

/**
 * Structural provenance vocabulary. **Neither level is a scientific
 * validation state.** They say what ORAtlas structurally observed, and nothing
 * about whether a claim is correct, supported, replicated, endorsed, or peer
 * reviewed. TRUST remains separate and attaches to a claim–citation relation,
 * never to a publication or a claim.
 *
 * - `published-structure` — ORAtlas verified the externally published protocol
 *   structure: declared artifact digests matched the observed bytes, declared
 *   paths were re-validated, and every declared claim target resolved in the
 *   publication's own cross-reference inventory.
 * - `source-byte` — ORAtlas additionally obtained the immutable source bytes
 *   and verified the declared source hashes and selectors.
 *
 * `source-byte` therefore implies `published-structure`; nothing implies
 * scientific standing.
 */
export const PUBLICATION_STRUCTURAL_PROVENANCE_LEVELS = [
  "published-structure",
  "source-byte",
] as const;
export const publicationStructuralProvenanceSchema = z.enum(
  PUBLICATION_STRUCTURAL_PROVENANCE_LEVELS,
);
export type PublicationStructuralProvenance = z.infer<typeof publicationStructuralProvenanceSchema>;

/** Pinned external protocol version of the `myst` adapter (dhuzard/oratlas-myst). */
export const MYST_PUBLICATION_PROTOCOL_VERSION = "0.2.0" as const;

/** Which artifact is authoritative for a publication's claim declarations. */
export const PUBLICATION_CLAIM_DECLARATION_AUTHORITIES = [
  "publication-source",
  "review-manifest",
] as const;
export const publicationClaimDeclarationAuthoritySchema = z.enum(
  PUBLICATION_CLAIM_DECLARATION_AUTHORITIES,
);
export type PublicationClaimDeclarationAuthority = z.infer<
  typeof publicationClaimDeclarationAuthoritySchema
>;

/** Kinds of artifact bytes a capture can retain. Generic, never MyST-specific. */
export const PUBLICATION_CAPTURE_ARTIFACT_KINDS = [
  "publication-manifest",
  "cross-reference-inventory",
  "claim-stream",
  "review-manifest",
  "review-claim-stream",
  "published-page-data",
  "source-document",
] as const;
export const publicationCaptureArtifactKindSchema = z.enum(PUBLICATION_CAPTURE_ARTIFACT_KINDS);
export type PublicationCaptureArtifactKind = z.infer<typeof publicationCaptureArtifactKindSchema>;

export const publicationSha256Schema = z.string().regex(/^[0-9a-f]{64}$/, {
  message: "Must be a lowercase 64-character SHA-256 hex digest.",
});

/** Bounded absolute https URL. Publication input is untrusted, so length is capped. */
export const publicationHttpsUrlSchema = z
  .string()
  .max(2_000)
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "Only https:// URLs are accepted.",
  });

/** Toolchain-neutral roles for normalized scientific content. Roles are optional when uncertain. */
export const PUBLICATION_CONTENT_ROLES = [
  "abstract",
  "introduction",
  "methods",
  "results",
  "discussion",
  "limitations",
  "references",
  "supplementary",
  "other",
] as const;
export const publicationContentRoleSchema = z.enum(PUBLICATION_CONTENT_ROLES);
export type PublicationContentRole = z.infer<typeof publicationContentRoleSchema>;

/** Which immutable captured representation produced normalized plain text. */
export const PUBLICATION_CONTENT_REPRESENTATIONS = [
  "published-structured-text",
  "source-text",
] as const;
export const publicationContentRepresentationSchema = z.enum(PUBLICATION_CONTENT_REPRESENTATIONS);
export type PublicationContentRepresentation = z.infer<
  typeof publicationContentRepresentationSchema
>;

export const PUBLICATION_CONTENT_COVERAGE = [
  "complete",
  "partial",
  "unknown",
  "unsupported",
] as const;
export const publicationContentCoverageSchema = z.enum(PUBLICATION_CONTENT_COVERAGE);

export const PUBLICATION_CONTENT_DOCUMENT_LIMIT = 64;
export const PUBLICATION_CONTENT_TEXT_LIMIT = 1_000_000;

/** Immutable, deterministic plain-text evaluation representation of one captured document. */
export const publicationContentDocumentSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(500).nullable(),
    role: publicationContentRoleSchema.nullable(),
    sourcePath: safeRepoRelativePathSchema.nullable(),
    publishedUrl: publicationHttpsUrlSchema.nullable(),
    representation: publicationContentRepresentationSchema,
    text: z.string().min(1).max(PUBLICATION_CONTENT_TEXT_LIMIT),
    sha256: publicationSha256Schema,
    /** Stable identity of the immutable capture slot which supplied the bytes. */
    sourceArtifactIdentitySha256: publicationSha256Schema,
    /** SHA-256 of the exact captured source artifact bytes. */
    sourceArtifactSha256: publicationSha256Schema,
  })
  .strict();
export type PublicationContentDocument = z.infer<typeof publicationContentDocumentSchema>;

export const publicationContentCompletenessSchema = z
  .object({
    returnedDocuments: z.number().int().nonnegative(),
    totalDocumentsKnown: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    coverage: publicationContentCoverageSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.totalDocumentsKnown !== null && value.returnedDocuments > value.totalDocumentsKnown) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnedDocuments"],
        message: "Returned content documents cannot exceed the known total.",
      });
    }
    if (
      value.totalDocumentsKnown !== null &&
      value.returnedDocuments < value.totalDocumentsKnown &&
      !value.truncated
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truncated"],
        message: "Missing known content documents must be reported as truncated.",
      });
    }
    if (value.coverage === "complete") {
      if (
        value.truncated ||
        value.totalDocumentsKnown === null ||
        value.returnedDocuments !== value.totalDocumentsKnown
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coverage"],
          message: "Complete coverage requires an untruncated known total.",
        });
      }
    }
    if (
      value.coverage === "unsupported" &&
      (value.returnedDocuments !== 0 || value.totalDocumentsKnown !== null || value.truncated)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage"],
        message: "Unsupported content must not fabricate documents or coverage.",
      });
    }
  });
export type PublicationContentCompleteness = z.infer<typeof publicationContentCompletenessSchema>;

export const normalizedPublicationContentSchema = z
  .object({
    documents: z.array(publicationContentDocumentSchema).max(PUBLICATION_CONTENT_DOCUMENT_LIMIT),
    completeness: publicationContentCompletenessSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.completeness.returnedDocuments !== value.documents.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completeness", "returnedDocuments"],
        message: "Returned content-document metadata must match the document array.",
      });
    }
    const seenIds = new Set<string>();
    for (const [index, document] of value.documents.entries()) {
      if (seenIds.has(document.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["documents", index, "id"],
          message: "Content document ids must be unique within a publication version.",
        });
      }
      seenIds.add(document.id);
    }
  });
export type NormalizedPublicationContent = z.infer<typeof normalizedPublicationContentSchema>;

/** Selector frames ORAtlas accepts for a publication claim occurrence. */
export const PUBLICATION_CLAIM_SELECTOR_REPRESENTATIONS = [
  "oratlas-myst-source-utf8-v1",
  "oratlas-source-utf8-v1",
] as const;
export const publicationClaimSelectorRepresentationSchema = z.enum(
  PUBLICATION_CLAIM_SELECTOR_REPRESENTATIONS,
);
export type PublicationClaimSelectorRepresentation = z.infer<
  typeof publicationClaimSelectorRepresentationSchema
>;

/**
 * Source-local claim id: chosen by the publication's author, unique only
 * inside one publication version, and never an ORAtlas identifier.
 */
export const sourceLocalClaimIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, {
    message:
      "Must start with a lowercase alphanumeric character and contain only lowercase letters, digits, '.', '_' or '-'.",
  });

/**
 * Source-local publication id: declared by the author and stable across that
 * publication's versions. Evidence for ORAtlas's own keying decision, never an
 * ORAtlas identity on its own.
 */
export const sourceLocalPublicationIdSchema = z.string().min(1).max(200);

/**
 * Where the exact source bytes can be obtained. Absent when the publication
 * declares none, which caps it at `published-structure` and is a first-class
 * state rather than a defect.
 *
 * Version and concept DOI stay distinct fields, as everywhere else in ORAtlas.
 */
export const publicationSourceDescriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("git"),
      repository: publicationHttpsUrlSchema,
      commit: commitShaSchema.optional(),
      ref: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("doi"),
      versionDoi: doiSchema,
      conceptDoi: doiSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("archive"),
      url: publicationHttpsUrlSchema,
      sha256: publicationSha256Schema,
      format: z.string().min(1).max(40).optional(),
    })
    .strict(),
]);
export type PublicationSourceDescriptor = z.infer<typeof publicationSourceDescriptorSchema>;

/**
 * Adapter-specific metadata, retained in an explicit typed representation
 * rather than leaking toolchain columns into the generic layer. Every variant
 * carries its own pinned external protocol version, so a producer contract can
 * move without silently reinterpreting stored records.
 */
export const publicationAdapterBindingSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("myst"),
      protocolVersion: z.literal(MYST_PUBLICATION_PROTOCOL_VERSION),
      /** Path of MyST's own cross-reference inventory, as the publication declared it. */
      crossReferenceInventoryPath: safeRepoRelativePathSchema,
      generatorName: z.string().min(1).max(120),
      generatorVersion: z.string().min(1).max(60),
    })
    .strict(),
]);
export type PublicationAdapterBinding = z.infer<typeof publicationAdapterBindingSchema>;

/**
 * Where one claim occurrence is addressable in the published structure.
 * Every variant MUST carry `identifier`: that is the generic field joining an
 * occurrence to the publication's own cross-reference inventory. Anything else
 * is variant-specific source metadata, retained but never treated as an
 * ORAtlas DOM id or ORAtlas identity.
 */
export const publicationClaimTargetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("myst-xref"),
      identifier: sourceLocalClaimIdSchema,
      /** DOM id the publication's build generates. Source metadata only. */
      htmlId: z.string().min(1).max(300),
    })
    .strict(),
  z
    .object({
      /** Adapter-neutral anchor for formats that expose a stable fragment. */
      type: z.literal("published-anchor"),
      identifier: sourceLocalClaimIdSchema,
      fragment: z.string().min(1).max(300),
    })
    .strict(),
]);
export type PublicationClaimTarget = z.infer<typeof publicationClaimTargetSchema>;

/** The generic field every target variant carries. */
export function publicationClaimTargetIdentifier(target: PublicationClaimTarget): string {
  return target.identifier;
}

/**
 * Byte-level binding of one occurrence to the declaring source document.
 * `documentSha256` is byte-identical to the digest ORAtlas computes for the
 * same file elsewhere, so a claim occurrence and a passage anchor agree on
 * which version of a page they discuss.
 */
export const publicationClaimSourceBindingSchema = z
  .object({
    documentPath: safeRepoRelativePathSchema,
    documentSha256: publicationSha256Schema,
    startLine: z.number().int().positive().max(10_000_000),
    endLine: z.number().int().positive().max(10_000_000),
    blockSha256: publicationSha256Schema,
  })
  .strict()
  .refine((binding) => binding.endLine >= binding.startLine, {
    message: "endLine must not precede startLine.",
    path: ["endLine"],
  });
export type PublicationClaimSourceBinding = z.infer<typeof publicationClaimSourceBindingSchema>;

/**
 * W3C selectors locating the occurrence in its declared frame. The frame is
 * explicit because ORAtlas's own `myst-rendered-text-v1` offsets are expressed
 * over ORAtlas's rendering and are never interchangeable with source offsets.
 */
export const publicationClaimSelectorSchema = z
  .object({
    representation: publicationClaimSelectorRepresentationSchema,
    unit: z.enum(["body", "block"]),
    textQuote: textQuoteSelectorSchema,
    textPosition: textPositionSelectorSchema,
  })
  .strict()
  .superRefine((selector, context) => {
    if (
      selector.textPosition.end - selector.textPosition.start !==
      unicodeCodePointLength(selector.textQuote.exact)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text position length must match the exact quoted source span.",
        path: ["textPosition", "end"],
      });
    }
  });
export type PublicationClaimSelector = z.infer<typeof publicationClaimSelectorSchema>;

/**
 * The semantic declaration, discriminated by which artifact owns it. When a
 * publication ships an ORAtlas review manifest that declares claims, that
 * manifest is authoritative and the occurrence carries binding only.
 */
export const publicationClaimDeclarationSchema = z.discriminatedUnion("authority", [
  z
    .object({
      authority: z.literal("publication-source"),
      text: z.string().min(1).max(5_000),
      claimType: claimTypeSchema.optional(),
      qualification: z.string().min(1).max(2_000).optional(),
    })
    .strict(),
  z.object({ authority: z.literal("review-manifest") }).strict(),
]);
export type PublicationClaimDeclaration = z.infer<typeof publicationClaimDeclarationSchema>;

/**
 * Evidence ORAtlas keys a stable publication identity from. A canonical URL is
 * deliberately not a basis of its own: a publication can move, be mirrored, or
 * be served from several hosts, and two publications can occupy one URL at
 * different times. `declared-identifier` pairs a URL origin with an
 * author-declared identifier; `registration` is an ORAtlas-minted opaque key
 * for a publication with no other durable evidence.
 */
export const publicationIdentityEvidenceSchema = z.discriminatedUnion("basis", [
  z
    .object({
      basis: z.literal("git-source"),
      repository: publicationHttpsUrlSchema,
      sourceLocalPublicationId: sourceLocalPublicationIdSchema.optional(),
    })
    .strict(),
  z.object({ basis: z.literal("concept-doi"), conceptDoi: doiSchema }).strict(),
  z
    .object({
      basis: z.literal("declared-identifier"),
      canonicalUrlOrigin: publicationHttpsUrlSchema,
      sourceLocalPublicationId: sourceLocalPublicationIdSchema,
    })
    .strict(),
  z
    .object({ basis: z.literal("registration"), registrationKey: z.string().min(1).max(200) })
    .strict(),
  z.object({ basis: z.literal("atlas-review"), reviewId: z.string().min(1).max(200) }).strict(),
]);
export type PublicationIdentityEvidence = z.infer<typeof publicationIdentityEvidenceSchema>;

/** Stable source-publication identity. Never an ORAtlas canonical graph node. */
export const publicationRecordSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_BOUNDARY_SCHEMA_VERSION),
    stableKey: z.string().min(1).max(500),
    publicationType: publicationTypeSchema,
    recordSource: publicationRecordSourceSchema,
    identityEvidence: publicationIdentityEvidenceSchema,
    sourceLocalPublicationId: sourceLocalPublicationIdSchema.optional(),
    /** Set only for `atlas-review-projection` records. */
    reviewId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const isProjection = record.recordSource === "atlas-review-projection";
    if (isProjection !== (record.identityEvidence.basis === "atlas-review")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A review projection must use, and only it may use, atlas-review identity evidence.",
        path: ["identityEvidence", "basis"],
      });
    }
    if (isProjection !== (record.reviewId !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewId is required for a review projection and forbidden otherwise.",
        path: ["reviewId"],
      });
    }
  });
export type PublicationRecord = z.infer<typeof publicationRecordSchema>;

/**
 * One exact, immutable, externally observed publication version.
 *
 * Identity is `(publication, sourcesSha256)`. A canonical URL is retained as
 * addressing metadata and is never identity, so a republished site, a mirror
 * and a moved deployment do not fabricate or destroy version identity.
 */
export const publicationVersionRecordSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_BOUNDARY_SCHEMA_VERSION),
    stableKey: z.string().min(1).max(500),
    publicationStableKey: z.string().min(1).max(500),
    sourceLocalPublicationId: sourceLocalPublicationIdSchema.optional(),
    sourcesSha256: publicationSha256Schema,
    versionLabel: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(500).optional(),
    canonicalUrl: publicationHttpsUrlSchema.optional(),
    adapter: publicationAdapterBindingSchema,
    source: publicationSourceDescriptorSchema.optional(),
    structuralProvenance: publicationStructuralProvenanceSchema,
    /** Recorded reason(s) a declared source did not reach source-byte provenance. */
    verificationWarnings: z.array(z.string().min(1).max(1_000)).max(100).default([]),
    observedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.structuralProvenance === "source-byte" && record.source === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "source-byte provenance requires a resolvable source descriptor; without one only published-structure is reachable.",
        path: ["structuralProvenance"],
      });
    }
  });
export type PublicationVersionRecord = z.infer<typeof publicationVersionRecordSchema>;

/**
 * Immutable record of exactly what ORAtlas observed for one artifact of one
 * publication version. Captures are append-only at the database layer: bytes
 * and digests can never be silently rewritten once observed.
 */
export const publicationCaptureRecordSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_BOUNDARY_SCHEMA_VERSION),
    publicationVersionStableKey: z.string().min(1).max(500),
    artifactKind: publicationCaptureArtifactKindSchema,
    /** Publication-relative path the artifact was declared at, re-validated before use. */
    declaredPath: safeRepoRelativePathSchema.optional(),
    /** Absolute location the bytes were observed at, when one exists. */
    observedUrl: publicationHttpsUrlSchema.optional(),
    /** URL requested before redirects, retained separately from the final observed URL. */
    requestedUrl: publicationHttpsUrlSchema.optional(),
    mediaType: z.string().min(1).max(120),
    /** SHA-256 over the exact observed bytes. Always recomputed, never copied. */
    contentSha256: publicationSha256Schema,
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Digest the publication declared for this artifact, retained separately. */
    declaredSha256: publicationSha256Schema.optional(),
    structuralProvenance: publicationStructuralProvenanceSchema,
    capturedAt: z.string().datetime(),
  })
  .strict();
export type PublicationCaptureRecord = z.infer<typeof publicationCaptureRecordSchema>;

/** Editor-authenticated request to register one externally hosted protocol manifest. */
export const externalPublicationRegistrationRequestSchema = z
  .object({
    manifestUrl: publicationHttpsUrlSchema,
    /** Schema 0.2.0 does not declare a publication type; editors may supply one. */
    publicationType: publicationTypeSchema.default("other"),
  })
  .strict();
export type ExternalPublicationRegistrationRequest = z.infer<
  typeof externalPublicationRegistrationRequestSchema
>;

/** Typed result of immutable external-publication registration. */
export const externalPublicationRegistrationResultSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    captureId: z.string().min(1),
    publicationId: z.string().min(1),
    publicationVersionId: z.string().min(1),
    manifestSchemaVersion: z.literal(MYST_PUBLICATION_PROTOCOL_VERSION),
    adapterType: publicationAdapterTypeSchema,
    claimOccurrenceCount: z.number().int().nonnegative(),
    verificationLevel: publicationStructuralProvenanceSchema,
    warnings: z.array(z.string().min(1).max(1_000)).max(100),
    replayed: z.boolean(),
    links: z
      .object({
        capture: z.string().startsWith("/"),
        publication: z.string().startsWith("/"),
        publicationVersion: z.string().startsWith("/"),
      })
      .strict(),
  })
  .strict();
export type ExternalPublicationRegistrationResult = z.infer<
  typeof externalPublicationRegistrationResultSchema
>;

/**
 * One exact occurrence of a claim declaration in one publication version.
 *
 * This is emphatically **not** a canonical claim identity. ORAtlas must not
 * infer that two occurrences describe the same claim from equal text, an equal
 * source-local id in different versions, an equal `declarationSha256`, an
 * equal `sourcesSha256`, position, ordering, or similarity. Canonical binding
 * is a separate, explicit, reviewed decision.
 */
export const publicationClaimOccurrenceRecordSchema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_BOUNDARY_SCHEMA_VERSION),
    stableKey: z.string().min(1).max(500),
    publicationVersionStableKey: z.string().min(1).max(500),
    sourceLocalClaimId: sourceLocalClaimIdSchema,
    target: publicationClaimTargetSchema,
    sourceBinding: publicationClaimSourceBindingSchema,
    selector: publicationClaimSelectorSchema,
    /** Content digest over the declaration alone. A digest, never an identity. */
    declarationSha256: publicationSha256Schema,
    declaration: publicationClaimDeclarationSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (publicationClaimTargetIdentifier(record.target) !== record.sourceLocalClaimId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The target identifier must equal the source-local claim id.",
        path: ["target", "identifier"],
      });
    }
  });
export type PublicationClaimOccurrenceRecord = z.infer<
  typeof publicationClaimOccurrenceRecordSchema
>;

/**
 * The planned canonical-graph source-union extension for an external
 * publication occurrence.
 *
 * The database column and its exclusive-union guard exist now (expand step);
 * no writer materializes one yet, and the public canonical graph response
 * contract is deliberately unchanged until a materializer exists. See
 * `docs/external-publications.md`.
 */
export const publicationClaimOccurrenceGraphSourceSchema = z
  .object({
    type: z.literal("publication-claim-occurrence"),
    publicationClaimOccurrenceId: z.string().min(1),
  })
  .strict();
export type PublicationClaimOccurrenceGraphSource = z.infer<
  typeof publicationClaimOccurrenceGraphSourceSchema
>;

export const publicationClaimMaterializationResultSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    publicationClaimOccurrenceId: z.string().min(1),
    knowledgeNodeId: z.string().min(1),
    knowledgeNodeVersionId: z.string().min(1),
    idempotent: z.boolean(),
    links: z
      .object({
        occurrence: z.string().startsWith("/"),
        canonicalGraph: z.string().startsWith("/"),
        canonicalOccurrence: z.string().startsWith("/"),
      })
      .strict(),
  })
  .strict();
export type PublicationClaimMaterializationResult = z.infer<
  typeof publicationClaimMaterializationResultSchema
>;

/**
 * Human-readable wording for a structural provenance level. Deliberately never
 * says verified, trustworthy, confirmed, or peer reviewed.
 */
export function describePublicationStructuralProvenance(
  level: PublicationStructuralProvenance,
): string {
  return level === "source-byte"
    ? "Published structure and declared source bytes were structurally checked."
    : "Published structure was structurally checked; source bytes were not obtained.";
}

/** `source-byte` subsumes `published-structure`; nothing subsumes scientific standing. */
export function publicationStructuralProvenanceSatisfies(
  reached: PublicationStructuralProvenance,
  required: PublicationStructuralProvenance,
): boolean {
  if (required === "published-structure") return true;
  return reached === "source-byte";
}
