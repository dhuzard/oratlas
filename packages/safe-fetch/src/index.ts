/**
 * `@oratlas/safe-fetch` — the one hardened outbound HTTP boundary.
 *
 * Anything ORAtlas retrieves from a host it does not control is fetched
 * through here: publication registration, DOI resolution, and any later
 * consumer. Having one implementation is the point — two URL-safety rules
 * drift, and the weaker one becomes the way in.
 *
 * Framework-free: no Prisma, no React, no Next. It reads bytes and refuses
 * unsafe destinations; it never parses, renders, or executes what it fetched.
 */
export {
  ADDRESS_CLASSES,
  classifyIpAddress,
  describeAddressClass,
  isIpLiteral,
  parseIpv4,
  type AddressClass,
} from "./address.js";

export {
  DEFAULT_URL_SAFETY_POLICY,
  SAFE_FETCH_ERROR_CODES,
  assessExternalUrl,
  isAddressClassAllowed,
  resolveUrlSafetyPolicy,
  type ResolvedUrlSafetyPolicy,
  type SafeFetchErrorCode,
  type UrlSafetyPolicy,
  type UrlSafetyResult,
} from "./url-safety.js";

export {
  OperationBudget,
  SAFE_FETCH_DEFAULTS,
  SafeFetchError,
  safeFetch,
  type LookupFunction,
  type SafeFetchOptions,
  type SafeFetchRedirect,
  type SafeFetchResponse,
} from "./fetch.js";

export {
  createSafeArtifactFetcher,
  type ArtifactFetchOptions,
  type FetchedArtifact,
  type SafeArtifactFetcher,
  type SafeArtifactFetcherOptions,
} from "./artifact-fetcher.js";
