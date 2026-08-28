import {
  OperationBudget,
  SAFE_FETCH_DEFAULTS,
  safeFetch,
  type LookupFunction,
  type SafeFetchRedirect,
} from "./fetch.js";
import { type UrlSafetyPolicy } from "./url-safety.js";

/**
 * A small, structurally-typed artifact fetcher over the hardened boundary.
 *
 * Domain packages declare the transport seam they need as an interface and
 * never import a transport. This factory returns an object whose shape
 * satisfies that seam structurally, so neither package depends on the other:
 * `@oratlas/publications` keeps its interface, `@oratlas/safe-fetch` keeps the
 * policy, and one implementation serves production and tests alike.
 */

export interface ArtifactFetchOptions {
  allowedMediaTypes: readonly string[];
  maxResponseBytes: number;
}

export interface FetchedArtifact {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  mediaType: string;
  bytes: Uint8Array;
  redirects: readonly SafeFetchRedirect[];
  retrievedAt: string;
}

export interface SafeArtifactFetcherOptions {
  policy?: UrlSafetyPolicy;
  /**
   * Budget shared by every retrieval this fetcher performs, so one logical
   * operation has one total time limit rather than a per-request one a slow
   * host can multiply.
   */
  budget?: OperationBudget;
  totalTimeoutMs?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  lookup?: LookupFunction;
}

export interface SafeArtifactFetcher {
  fetchArtifact(url: string, options: ArtifactFetchOptions): Promise<FetchedArtifact>;
  /** The shared budget, exposed so a caller can reason about the whole operation. */
  readonly budget: OperationBudget;
}

export function createSafeArtifactFetcher(
  options: SafeArtifactFetcherOptions = {},
): SafeArtifactFetcher {
  const budget =
    options.budget ??
    new OperationBudget(options.totalTimeoutMs ?? SAFE_FETCH_DEFAULTS.totalTimeoutMs);

  return {
    budget,
    async fetchArtifact(url, fetchOptions) {
      const response = await safeFetch(url, {
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        budget,
        allowedMediaTypes: fetchOptions.allowedMediaTypes,
        maxResponseBytes: fetchOptions.maxResponseBytes,
        ...(options.connectTimeoutMs === undefined
          ? {}
          : { connectTimeoutMs: options.connectTimeoutMs }),
        ...(options.readTimeoutMs === undefined ? {} : { readTimeoutMs: options.readTimeoutMs }),
        ...(options.maxRedirects === undefined ? {} : { maxRedirects: options.maxRedirects }),
        ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
        ...(options.lookup === undefined ? {} : { lookup: options.lookup }),
        accept: fetchOptions.allowedMediaTypes.join(", "),
      });
      return {
        requestedUrl: response.requestedUrl,
        finalUrl: response.finalUrl,
        status: response.status,
        mediaType: response.mediaType,
        bytes: response.bytes,
        redirects: response.redirects,
        retrievedAt: response.retrievedAt,
      };
    },
  };
}
