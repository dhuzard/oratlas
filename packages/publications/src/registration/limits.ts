/**
 * Registration limits.
 *
 * Every number a publication declares is untrusted — its artifact sizes, its
 * record count, its inventory length, the number of pages it points at. Each
 * one is capped independently, and a cap is enforced against what was actually
 * read as well as against what was declared, because a producer that lies
 * about a count is exactly the case these exist for.
 */
export interface RegistrationLimits {
  maxManifestBytes: number;
  maxInventoryBytes: number;
  maxClaimStreamBytes: number;
  maxPageDataBytes: number;
  maxReviewManifestBytes: number;
  /** Records ORAtlas will read from a claim stream, whatever it declares. */
  maxClaimRecords: number;
  /** Total HTTP retrievals one registration may perform. */
  maxArtifactFetches: number;
  /** Distinct source documents one source-byte verification may read. */
  maxSourceDocuments: number;
}

export const DEFAULT_REGISTRATION_LIMITS: RegistrationLimits = {
  maxManifestBytes: 256 * 1024,
  maxInventoryBytes: 8 * 1024 * 1024,
  maxClaimStreamBytes: 8 * 1024 * 1024,
  maxPageDataBytes: 8 * 1024 * 1024,
  maxReviewManifestBytes: 256 * 1024,
  maxClaimRecords: 5_000,
  maxArtifactFetches: 64,
  maxSourceDocuments: 200,
};

/**
 * Media types ORAtlas will accept for each artifact.
 *
 * Content-type checking is sanity checking, not security: the bytes are
 * validated regardless. It is here so an HTML error page or a login redirect
 * that answered 200 is refused as the wrong kind of thing rather than being
 * parsed as a manifest. Nothing retrieved is ever rendered or executed, so an
 * `text/html` body is refused rather than handled.
 */
export const ARTIFACT_MEDIA_TYPES = {
  manifest: ["application/json", "text/json"],
  inventory: ["application/json", "text/json"],
  claimStream: [
    "application/jsonl",
    "application/x-ndjson",
    "application/x-jsonlines",
    "application/json",
    "text/jsonl",
    "text/plain",
  ],
  pageData: ["application/json", "text/json"],
  reviewManifest: ["application/json", "text/json"],
} as const;
