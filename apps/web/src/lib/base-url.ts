import { getServerEnv } from "@oratlas/config";

/**
 * Configured application origin without a trailing slash. Canonical version
 * URLs, feed IRIs and export identifiers are all composed from this value and
 * must agree exactly.
 */
export function appBaseUrl(): string {
  return getServerEnv().NEXT_PUBLIC_BASE_URL.replace(/\/+$/, "");
}
