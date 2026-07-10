import { createHash } from "node:crypto";
import {
  type EvidenceCitation,
  type EvidenceClaim,
  type EvidencePacket,
} from "@oratlas/contracts";
import { lexicalScore, tokenize, tokenSet } from "./text.js";
import { type KnowledgeIndexData } from "./types.js";

export interface BuildPacketOptions {
  maxClaims?: number;
  /** Restrict to these review slugs (thread scope). */
  reviewSlugs?: string[];
  now?: () => Date;
}

/**
 * Build an evidence packet for a question (spec §14). The knowledge unit is not
 * a text chunk: each claim carries its review identity, anchor, relations, and
 * TRUST status. Only claims from accepted review versions are included.
 */
export function buildEvidencePacket(
  data: KnowledgeIndexData,
  question: string,
  options: BuildPacketOptions = {},
): EvidencePacket {
  const now = options.now ?? (() => new Date());
  const maxClaims = options.maxClaims ?? 20;
  const qTokens = tokenize(question);

  let claims = data.claims;
  if (options.reviewSlugs && options.reviewSlugs.length > 0) {
    const allow = new Set(options.reviewSlugs);
    claims = claims.filter((c) => allow.has(c.reviewSlug));
  }

  const ranked = claims
    .map((c) => ({ c, score: lexicalScore(qTokens, tokenSet(`${c.text} ${c.reviewTitle}`)) }))
    .filter((r) => (qTokens.length === 0 ? true : r.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxClaims)
    .map((r) => r.c);

  const usedCitationIds = new Set<string>();
  const evidenceClaims: EvidenceClaim[] = ranked.map((c) => {
    for (const rel of c.relations) usedCitationIds.add(rel.citationId);
    return {
      claimId: c.claimId,
      reviewSlug: c.reviewSlug,
      reviewTitle: c.reviewTitle,
      reviewVersionId: c.reviewVersionId,
      commitSha: c.commitSha,
      versionDoi: c.versionDoi,
      text: c.text,
      section: c.section,
      anchor: c.anchor,
      claimType: c.claimType,
      relations: c.relations.map((rel) => ({
        citationId: rel.citationId,
        relationType: rel.relationType,
        trust: rel.trust
          ? {
              reviewStatus: rel.trust.reviewStatus,
              aggregateScore: rel.trust.aggregateScore,
              aggregateMethod: rel.trust.aggregateMethod,
              notableCriteria: rel.trust.notableCriteria,
            }
          : undefined,
      })),
    };
  });

  const citations: EvidenceCitation[] = data.citations
    .filter((c) => usedCitationIds.has(c.citationId))
    .map((c) => ({
      citationId: c.citationId,
      doi: c.doi,
      title: c.title,
      year: c.year,
      source: c.source,
    }));

  const reviewSlugs = new Set(evidenceClaims.map((c) => c.reviewSlug));
  const reviews = data.reviews
    .filter((r) => reviewSlugs.has(r.reviewSlug))
    .map((r) => ({
      reviewSlug: r.reviewSlug,
      reviewVersionId: r.reviewVersionId,
      title: r.title,
      commitSha: r.commitSha,
      versionDoi: r.versionDoi,
      conceptDoi: r.conceptDoi,
    }));

  return {
    schemaVersion: "1.0.0",
    question,
    builtAt: now().toISOString(),
    reviews,
    claims: evidenceClaims,
    citations,
  };
}

/** Stable hash of the evidence packet (persisted with AgentRun for provenance). */
export function hashEvidencePacket(packet: EvidencePacket): string {
  const canonical = JSON.stringify({
    question: packet.question,
    claims: packet.claims.map((c) => c.claimId).sort(),
    citations: packet.citations.map((c) => c.citationId).sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
