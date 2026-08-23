import { createHash } from "node:crypto";
import {
  canonicalJson,
  publicationIdentityEvidenceSchema,
  publicationSha256Schema,
  sourceLocalClaimIdSchema,
  type PublicationIdentityEvidence,
  type PublicationSourceDescriptor,
} from "@oratlas/contracts";

/**
 * Stable keys for the generic publication boundary.
 *
 * A key here is an addressing key, not a scientific assertion. Two records
 * sharing a key are the same observed object; two records with different keys
 * are not thereby different scientific objects. Canonical graph identity is a
 * separate, explicit decision and is never derived from these keys.
 */

export class PublicationIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationIdentityError";
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Stable identity of a source publication across its versions.
 *
 * The key is derived from durable identity evidence only. A canonical URL is
 * never evidence on its own: a publication can move, be mirrored, or be served
 * from several hosts, and two publications can occupy one URL at different
 * times.
 */
export function publicationStableKey(evidence: PublicationIdentityEvidence): string {
  const parsed = publicationIdentityEvidenceSchema.parse(evidence);
  if (parsed.basis === "atlas-review") return `publication:review:v1:${parsed.reviewId}`;
  return `publication:external:v1:${sha256Hex(canonicalJson(parsed))}`;
}

/**
 * Identity of one exact observed version.
 *
 * `sourcesSha256` is the publication's own digest over its complete document
 * set. It always exists — including for a plain website with no repository,
 * DOI or archive — which is what lets ORAtlas tell version 1 from version 2
 * without treating a mutable URL as identity.
 *
 * The same `sourcesSha256` under two different publications yields two
 * different version keys: an equal source digest is not publication identity.
 */
export function publicationVersionStableKey(publicationKey: string, sourcesSha256: string): string {
  if (publicationKey.length === 0) {
    throw new PublicationIdentityError("A publication version requires its publication identity.");
  }
  const digest = publicationSha256Schema.safeParse(sourcesSha256);
  if (!digest.success) {
    throw new PublicationIdentityError(
      "A publication version requires an exact lowercase sourcesSha256 digest.",
    );
  }
  return `publication-version:v1:${sha256Hex(
    canonicalJson({ publication: publicationKey, sourcesSha256: digest.data }),
  )}`;
}

/**
 * Identity of one claim occurrence inside one exact publication version.
 *
 * The source-local claim id is unique only inside its publication version, so
 * the key is scoped to that version. Two versions declaring the same local id
 * therefore produce two distinct occurrence keys — deliberately, because a
 * repeated local id is not evidence of claim continuity.
 */
export function publicationClaimOccurrenceStableKey(
  publicationVersionKey: string,
  sourceLocalClaimId: string,
): string {
  if (publicationVersionKey.length === 0) {
    throw new PublicationIdentityError("A claim occurrence requires its exact version identity.");
  }
  const localId = sourceLocalClaimIdSchema.safeParse(sourceLocalClaimId);
  if (!localId.success) {
    throw new PublicationIdentityError(
      "A claim occurrence requires a valid source-local claim id.",
    );
  }
  return `publication-claim-occurrence:v1:${sha256Hex(
    canonicalJson({ publicationVersion: publicationVersionKey, sourceLocalClaimId: localId.data }),
  )}`;
}

export interface PublicationIdentityInput {
  /** Author-declared identifier, stable across versions. Evidence, not identity. */
  sourceLocalPublicationId?: string;
  /** Absolute https URL the publication is served from. Addressing, not identity. */
  canonicalUrl?: string;
  /** Where the exact source bytes can be obtained, when the publication declares it. */
  source?: PublicationSourceDescriptor;
  /** Opaque key minted by ORAtlas at registration for a publication with no other evidence. */
  registrationKey?: string;
}

/**
 * Choose the identity evidence ORAtlas keys a publication from, preferring the
 * most durable basis available.
 *
 * Fails closed when the only thing on offer is a canonical URL. A version DOI
 * and an archive digest are deliberately not bases either: each identifies one
 * exact version, not the publication that persists across versions.
 */
export function derivePublicationIdentityEvidence(
  input: PublicationIdentityInput,
): PublicationIdentityEvidence {
  const { source } = input;
  if (source?.type === "git") {
    return publicationIdentityEvidenceSchema.parse({
      basis: "git-source",
      repository: source.repository,
      ...(input.sourceLocalPublicationId === undefined
        ? {}
        : { sourceLocalPublicationId: input.sourceLocalPublicationId }),
    });
  }
  if (source?.type === "doi" && source.conceptDoi !== undefined) {
    return publicationIdentityEvidenceSchema.parse({
      basis: "concept-doi",
      conceptDoi: source.conceptDoi,
    });
  }
  if (input.sourceLocalPublicationId !== undefined && input.canonicalUrl !== undefined) {
    let origin: string;
    try {
      origin = new URL(input.canonicalUrl).origin;
    } catch {
      throw new PublicationIdentityError("The declared canonical URL is not a valid absolute URL.");
    }
    return publicationIdentityEvidenceSchema.parse({
      basis: "declared-identifier",
      canonicalUrlOrigin: origin,
      sourceLocalPublicationId: input.sourceLocalPublicationId,
    });
  }
  if (input.registrationKey !== undefined) {
    return publicationIdentityEvidenceSchema.parse({
      basis: "registration",
      registrationKey: input.registrationKey,
    });
  }
  throw new PublicationIdentityError(
    "A canonical URL alone is not publication identity. Declare a git or concept-DOI source, an author-declared publication id, or register an explicit ORAtlas registration key.",
  );
}
