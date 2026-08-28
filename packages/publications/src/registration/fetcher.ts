import { type PublicationHttpProvenance } from "@oratlas/contracts";

/**
 * The transport seam for registration.
 *
 * `@oratlas/publications` never opens a socket. Registration is expressed
 * against this interface and the caller supplies an implementation — in
 * ORAtlas that is `@oratlas/safe-fetch`, which enforces the https-only,
 * public-destination, redirect-bounded, size-bounded, timeout-bounded policy.
 * A test supplies a deterministic local one. Keeping the seam here is what
 * lets the pipeline's rules be tested exhaustively without a network.
 */

export interface PublicationFetchOptions {
  /** Media types the caller will accept. Enforced fail-closed by the transport. */
  allowedMediaTypes: readonly string[];
  /** Hard byte cap for this retrieval. */
  maxResponseBytes: number;
}

export interface FetchedArtifactBytes {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  /** Media type with parameters stripped and lower-cased. */
  mediaType: string;
  /** Exact observed bytes. Digests are recomputed from these, never copied. */
  bytes: Uint8Array;
  redirects: readonly { from: string; to: string; status: number }[];
  /** RFC 3339 timestamp the retrieval completed at. */
  retrievedAt: string;
}

export interface PublicationArtifactFetcher {
  fetchArtifact(url: string, options: PublicationFetchOptions): Promise<FetchedArtifactBytes>;
}

/** HTTP provenance for a retrieval, in the shape a capture retains. */
export function provenanceOf(fetched: FetchedArtifactBytes): PublicationHttpProvenance {
  return {
    requestedUrl: fetched.requestedUrl,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    mediaType: fetched.mediaType,
    byteLength: fetched.bytes.byteLength,
    redirects: fetched.redirects.map((hop) => ({ ...hop })),
    retrievedAt: fetched.retrievedAt,
  };
}

/**
 * Whether a transport failure was a refusal to even attempt the URL (an unsafe
 * scheme, host, port or destination) rather than a failure to retrieve it.
 *
 * The distinction matters to an operator: "that URL is not acceptable" is
 * actionable, "the site did not answer" is not the same problem. The check is
 * structural rather than an instanceof, so the domain package stays free of a
 * dependency on the transport implementation.
 */
export function isUrlRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("url-");
}
