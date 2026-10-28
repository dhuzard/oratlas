import type { Metadata } from "next";

/**
 * Parameterised `/explore` views (`known`, `focus`, `reviewSlug`, …) form an unbounded,
 * combinatorial URL space. Crawlers following node links exhaust the small Cloud Run
 * instance pool, so these views are marked noindex/nofollow. The bare `/explore` entry
 * page stays indexable.
 */
export function exploreRobots(
  parameters: Record<string, string | string[] | undefined>,
): Metadata["robots"] | undefined {
  const hasQuery = Object.values(parameters).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined,
  );
  return hasQuery ? { index: false, follow: false } : undefined;
}
