import { z } from "zod";
import { claimTypeSchema } from "./enums.js";
import { safeRepoRelativePathSchema } from "./paths.js";
import { publicationAdapterTypeSchema } from "./publication-adapters.js";
import { canonicalGraphEdgeSchema } from "./canonical-graph.js";
import { publicChallengeSchema } from "./challenges.js";
import {
  publicPublicationProductionAssertionSchema,
  PUBLICATION_PRODUCTION_ASSERTION_LIMIT,
} from "./publication-provenance.js";
import {
  publicPublicationContributorSchema,
  PUBLICATION_CONTRIBUTOR_LIMIT,
} from "./publication-contributors.js";
import {
  publicationCaptureArtifactKindSchema,
  publicationClaimDeclarationAuthoritySchema,
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationClaimTargetSchema,
  publicationContentCompletenessSchema,
  publicationContentDocumentSchema,
  publicationHttpsUrlSchema,
  publicationRecordSourceSchema,
  publicationSha256Schema,
  publicationStructuralProvenanceSchema,
  publicationTypeSchema,
  sourceLocalClaimIdSchema,
  sourceLocalPublicationIdSchema,
  PUBLICATION_CONTENT_DOCUMENT_LIMIT,
} from "./publications.js";

/** Current packet produced for new exact-version snapshots. */
export const PUBLICATION_VERSION_PACKET_SCHEMA_VERSION = "1.3.0" as const;
/** Historical packet schema retained for immutable CertificationRun inputs. */
export const PUBLICATION_VERSION_PACKET_LEGACY_SCHEMA_VERSION = "1.2.0" as const;
export const PUBLICATION_VERSION_PACKET_OCCURRENCE_LIMIT = 500;
export const PUBLICATION_VERSION_PACKET_CAPTURE_LIMIT = 1_000;
export const PUBLICATION_VERSION_PACKET_RELATION_LIMIT = 2_000;
export const PUBLICATION_VERSION_PACKET_CHALLENGE_LIMIT = 500;

const packetCompletenessSectionSchema = z
  .object({
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

const packetCoreFields = {
  publication: z
    .object({
      id: z.string().min(1),
      publicationType: publicationTypeSchema,
      recordSource: publicationRecordSourceSchema,
      sourceLocalPublicationId: sourceLocalPublicationIdSchema.nullable(),
    })
    .strict(),
  version: z
    .object({
      id: z.string().min(1),
      sourcesSha256: publicationSha256Schema,
      sourceLocalPublicationId: sourceLocalPublicationIdSchema.nullable(),
      versionLabel: z.string().nullable(),
      title: z.string().nullable(),
      publisherCanonicalUrl: publicationHttpsUrlSchema.nullable(),
      observedPublicationBaseUrl: publicationHttpsUrlSchema,
      adapterType: publicationAdapterTypeSchema,
      structuralProvenance: publicationStructuralProvenanceSchema,
      observedAt: z.string().datetime(),
    })
    .strict(),
  captures: z
    .array(
      z
        .object({
          id: z.string().min(1),
          artifactKind: publicationCaptureArtifactKindSchema,
          declaredPath: safeRepoRelativePathSchema.nullable(),
          requestedUrl: z.string().url().max(2_000).nullable(),
          observedUrl: z.string().url().max(2_000).nullable(),
          contentSha256: publicationSha256Schema,
          byteLength: z.number().int().nonnegative(),
          structuralProvenance: publicationStructuralProvenanceSchema,
        })
        .strict(),
    )
    .max(PUBLICATION_VERSION_PACKET_CAPTURE_LIMIT),
  content: z.array(publicationContentDocumentSchema).max(PUBLICATION_CONTENT_DOCUMENT_LIMIT),
  occurrences: z
    .array(
      z
        .object({
          id: z.string().min(1),
          sourceLocalClaimId: sourceLocalClaimIdSchema,
          publishedTargetUrl: publicationHttpsUrlSchema,
          target: publicationClaimTargetSchema,
          sourceBinding: publicationClaimSourceBindingSchema,
          selector: publicationClaimSelectorSchema,
          declarationSha256: publicationSha256Schema,
          declarationAuthority: publicationClaimDeclarationAuthoritySchema,
          text: z.string().nullable(),
          claimType: claimTypeSchema.nullable(),
          qualification: z.string().nullable(),
          canonicalBinding: z
            .object({
              knowledgeNodeId: z.string().min(1),
              knowledgeNodeVersionId: z.string().min(1),
            })
            .strict()
            .nullable(),
          links: z
            .object({
              occurrence: z.string().startsWith("/"),
              canonicalGraph: z.string().startsWith("/").nullable(),
              originalPublication: publicationHttpsUrlSchema,
            })
            .strict(),
        })
        .strict(),
    )
    .max(PUBLICATION_VERSION_PACKET_OCCURRENCE_LIMIT),
  productionProvenance: z
    .array(publicPublicationProductionAssertionSchema)
    .max(PUBLICATION_PRODUCTION_ASSERTION_LIMIT),
  relations: z.array(canonicalGraphEdgeSchema).max(PUBLICATION_VERSION_PACKET_RELATION_LIMIT),
  challenges: z.array(publicChallengeSchema).max(PUBLICATION_VERSION_PACKET_CHALLENGE_LIMIT),
  sha256: publicationSha256Schema,
} as const;

const legacyCompletenessSchema = z
  .object({
    captures: packetCompletenessSectionSchema,
    content: publicationContentCompletenessSchema,
    occurrences: packetCompletenessSectionSchema,
    productionProvenance: packetCompletenessSectionSchema,
    relations: packetCompletenessSectionSchema,
    challenges: packetCompletenessSectionSchema,
  })
  .strict();

const legacyLinksSchema = z
  .object({
    self: z.string().startsWith("/"),
    publication: z.string().startsWith("/"),
    publicationVersion: z.string().startsWith("/"),
    content: z.string().startsWith("/"),
    productionProvenance: z.string().startsWith("/"),
  })
  .strict();

function validatePacketContent(
  value: {
    content: Array<{ id: string }>;
    completeness: { content: { returnedDocuments: number } };
  },
  context: z.RefinementCtx,
) {
  if (value.completeness.content.returnedDocuments !== value.content.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completeness", "content", "returnedDocuments"],
      message: "Packet content completeness must match the returned content array.",
    });
  }
  const seenIds = new Set<string>();
  for (const [index, document] of value.content.entries()) {
    if (seenIds.has(document.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content", index, "id"],
        message: "Packet content document ids must be unique.",
      });
    }
    seenIds.add(document.id);
  }
}

/** Exact historical 1.2.0 shape. Do not add contributor fields to this schema. */
export const publicationVersionPacketV1_2Schema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_VERSION_PACKET_LEGACY_SCHEMA_VERSION),
    ...packetCoreFields,
    completeness: legacyCompletenessSchema,
    links: legacyLinksSchema,
  })
  .strict()
  .superRefine(validatePacketContent);

export const publicationVersionPacketV1_3Schema = z
  .object({
    schemaVersion: z.literal(PUBLICATION_VERSION_PACKET_SCHEMA_VERSION),
    ...packetCoreFields,
    contributors: z.array(publicPublicationContributorSchema).max(PUBLICATION_CONTRIBUTOR_LIMIT),
    completeness: legacyCompletenessSchema
      .extend({ contributors: packetCompletenessSectionSchema })
      .strict(),
    links: legacyLinksSchema.extend({ contributors: z.string().startsWith("/") }).strict(),
  })
  .strict()
  .superRefine((value, context) => {
    validatePacketContent(value, context);
    if (value.completeness.contributors.returned !== value.contributors.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completeness", "contributors", "returned"],
        message: "Packet contributor completeness must match the returned snapshots.",
      });
    }
  });

/** Explicit reader for current and immutable historical packet snapshots. */
export const publicationVersionPacketSchema = z.union([
  publicationVersionPacketV1_2Schema,
  publicationVersionPacketV1_3Schema,
]);
export type PublicationVersionPacketV1_2 = z.infer<typeof publicationVersionPacketV1_2Schema>;
export type PublicationVersionPacketV1_3 = z.infer<typeof publicationVersionPacketV1_3Schema>;
export type PublicationVersionPacket = z.infer<typeof publicationVersionPacketSchema>;
