import { createHash } from "node:crypto";
import {
  evidencePacketSchema,
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
      localClaimId: c.localClaimId,
      reviewSlug: c.reviewSlug,
      reviewTitle: c.reviewTitle,
      reviewVersionId: c.reviewVersionId,
      commitSha: c.commitSha,
      versionDoi: c.versionDoi,
      text: c.text,
      section: c.section,
      anchor: c.anchor,
      sourceAnchor: c.sourceAnchor,
      claimType: c.claimType,
      relations: c.relations.map((rel) => {
        const trustAssessments = (rel.trustAssessments ?? (rel.trust ? [rel.trust] : [])).map(
          (assessment) => ({
            assessmentId: assessment.assessmentId,
            protocolVersion: assessment.protocolVersion,
            assessorType: assessment.assessorType,
            assessorId: assessment.assessorId,
            assessedAt: assessment.assessedAt,
            reviewStatus: assessment.reviewStatus,
            verificationState: assessment.verificationState,
            aggregateScore: assessment.aggregateScore,
            aggregateMethod: assessment.aggregateMethod,
            notableCriteria: assessment.notableCriteria,
          }),
        );
        return {
          citationId: rel.citationId,
          relationType: rel.relationType,
          trust: trustAssessments.length === 1 ? trustAssessments[0] : undefined,
          trustAssessments,
        };
      }),
    };
  });

  const citations: EvidenceCitation[] = data.citations
    .filter((c) => usedCitationIds.has(c.citationId))
    .map((c) => ({
      citationId: c.citationId,
      localCitationId: c.localCitationId,
      reviewVersionId: c.reviewVersionId,
      workId: c.workId,
      canonicalWorkAliases: c.canonicalWorkAliases,
      doi: c.doi,
      pmid: c.pmid,
      openAlexId: c.openAlexId,
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
    schemaVersion: "1.1.0",
    question,
    builtAt: now().toISOString(),
    reviews,
    claims: evidenceClaims,
    citations,
    identifierConflicts: data.identifierConflicts.filter((conflict) =>
      conflict.citationIds.some((citationId) => usedCitationIds.has(citationId)),
    ),
  };
}

export interface PreparedEvidencePacket {
  packet: EvidencePacket;
  /** Canonical UTF-8 JSON bytes represented as a JavaScript string. */
  json: string;
  sha256: string;
}

/**
 * Validate, canonicalize exactly once, then hash those exact bytes. Callers
 * pass `json` unchanged to the provider and persistence layer.
 */
export function prepareEvidencePacket(packet: EvidencePacket): PreparedEvidencePacket {
  const validated = evidencePacketSchema.parse(packet);
  const json = canonicalJson(validated);
  return {
    packet: validated,
    json,
    sha256: hashEvidencePacket(json),
  };
}

/** SHA-256 of packet bytes. Object input is retained for non-LLM callers. */
export function hashEvidencePacket(packet: EvidencePacket | string): string {
  const bytes =
    typeof packet === "string" ? packet : canonicalJson(evidencePacketSchema.parse(packet));
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

/** RFC-8785-style deterministic object-key ordering for JSON-compatible data. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as canonical JSON.`);
}
