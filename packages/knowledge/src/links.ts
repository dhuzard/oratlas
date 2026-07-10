import { type LinkProposalType } from "@oratlas/contracts";
import { jaccard, tokenSet } from "./text.js";
import { type IndexedClaim } from "./types.js";

export interface LinkProposalDraft {
  sourceClaimId: string;
  targetClaimId: string;
  sourceReviewSlug: string;
  targetReviewSlug: string;
  proposedRelation: LinkProposalType;
  features: {
    sharedCitations: string[];
    normalizedTokenOverlap: number;
    method: string;
  };
  semanticSimilarity: number;
  rationale: string;
}

export interface LinkProposerOptions {
  /** Minimum normalized-text overlap to propose a similarity link. */
  similarityThreshold?: number;
  /** Cap on proposals produced (keeps it conservative). */
  maxProposals?: number;
  agentProvenance?: string;
}

/**
 * Conservative deterministic cross-review link proposals (spec §15). For the
 * POC we use two transparent signals: shared citation DOIs and normalized claim
 * text similarity. Proposals are drafts (status `proposed`), never facts, and
 * are only made ACROSS reviews (never within one).
 */
export function proposeCrossReviewLinks(
  claims: IndexedClaim[],
  options: LinkProposerOptions = {},
): LinkProposalDraft[] {
  const threshold = options.similarityThreshold ?? 0.18;
  const maxProposals = options.maxProposals ?? 50;
  const proposals: LinkProposalDraft[] = [];
  const seen = new Set<string>();

  const enriched = claims.map((c) => ({
    claim: c,
    tokens: tokenSet(c.text),
    citationDois: new Set(c.relations.map((r) => r.citationId)),
  }));

  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i]!;
      const b = enriched[j]!;
      // Only propose links across different reviews.
      if (a.claim.reviewSlug === b.claim.reviewSlug) continue;

      const shared = [...a.citationDois].filter((d) => b.citationDois.has(d));
      const overlap = jaccard(a.tokens, b.tokens);

      let relation: LinkProposalType | undefined;
      let rationale = "";

      if (shared.length > 0) {
        relation = "shared-citations";
        rationale = `Both claims are linked to ${shared.length} shared citation(s): ${shared.join(", ")}.`;
      } else if (overlap >= threshold) {
        relation = "semantically-similar-claims";
        rationale = `Normalized claim-text overlap ${overlap.toFixed(2)} exceeded the proposal threshold ${threshold}.`;
      }

      if (!relation) continue;

      const key = [a.claim.claimId, b.claim.claimId, relation].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      proposals.push({
        sourceClaimId: a.claim.claimId,
        targetClaimId: b.claim.claimId,
        sourceReviewSlug: a.claim.reviewSlug,
        targetReviewSlug: b.claim.reviewSlug,
        proposedRelation: relation,
        features: {
          sharedCitations: shared,
          normalizedTokenOverlap: Math.round(overlap * 100) / 100,
          method: shared.length > 0 ? "shared-citation" : "lexical-jaccard",
        },
        semanticSimilarity: Math.round(overlap * 100) / 100,
        rationale,
      });
      if (proposals.length >= maxProposals) return proposals;
    }
  }

  return proposals;
}
