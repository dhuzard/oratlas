/**
 * Private response composition (ADR-0001 §9.5, T-CACHE; docs/private-workspace-g1-harness.md).
 *
 * G1 fixture only: no route uses this yet, and public routes must not import it (the
 * architecture-boundaries guard treats `lib/private/**` as private). It is the single response
 * construction boundary future `/api/private/**` handlers are meant to pass through:
 *
 * - `Cache-Control: private, no-store` replaces any caller value;
 * - `Vary` gains `Cookie` (merged case-insensitively, no duplicates; `Vary: *` is preserved as is);
 * - content-derived validators (`ETag`, `Last-Modified`) are removed, so a client can never make a
 *   conditional request that the private pipeline would answer with `304`;
 * - a `304` is refused rather than rewritten: a body-less `304` cannot become a truthful `200`.
 *
 * Limits: this does not authorize anything, cannot stop an upstream cache/CDN that already holds a
 * response, and says nothing about Next.js data/route caching for a given deployment.
 */

export const PRIVATE_CACHE_CONTROL = "private, no-store";
const VALIDATOR_HEADERS = ["etag", "last-modified"] as const;

export class PrivateResponseError extends Error {
  override readonly name = "PrivateResponseError";
}

/** Merge `token` into a `Vary` value case-insensitively, keeping existing tokens and their order. */
export function mergeVary(existing: string | null, token: string): string {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of (existing ?? "").split(",")) {
    const value = raw.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    tokens.push(value);
  }
  // `*` already makes the response unmatchable; keep the caller's tokens exactly, add nothing.
  if (seen.has("*")) return tokens.join(", ");
  if (!seen.has(token.toLowerCase())) tokens.push(token);
  return tokens.join(", ");
}

/**
 * Return a response with private, non-reusable caching semantics. Status, status text and body
 * stream are preserved; only the cache-relevant headers change.
 */
export function privateResponse(response: Response): Response {
  if (response.status === 304) {
    throw new PrivateResponseError("Private responses must not be 304 Not Modified");
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
  headers.set("Vary", mergeVary(headers.get("Vary"), "Cookie"));
  for (const name of VALIDATOR_HEADERS) headers.delete(name);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
