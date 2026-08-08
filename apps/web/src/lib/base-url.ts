import { canonicalOrigin } from "./public-discovery";

/**
 * Configured application origin without a trailing slash. Canonical version
 * URLs, feed IRIs and export identifiers are all composed from this value and
 * must agree exactly.
 */
export function appBaseUrl(): string {
  return canonicalOrigin().origin;
}
