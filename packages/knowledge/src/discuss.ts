import {
  groundedAnswerSchema,
  validateGrounding,
  type DeterministicDiscussionResult,
  type EvidencePacket,
  type GroundedAnswer,
  type GroundingValidationResult,
} from "@oratlas/contracts";
import { type PreparedEvidencePacket } from "./packet.js";

/**
 * Deterministic discussion mode (spec §14). When no LLM key is configured, we
 * do NOT fabricate prose. We retrieve relevant claims, group them by evidence
 * relation, and return a structured evidence summary.
 */
export function discussDeterministic(packet: EvidencePacket): DeterministicDiscussionResult {
  const byRelation = new Map<string, EvidencePacket["claims"]>();

  for (const claim of packet.claims) {
    if (claim.relations.length === 0) {
      pushInto(byRelation, "no-linked-citation", claim);
      continue;
    }
    const seen = new Set<string>();
    for (const rel of claim.relations) {
      if (seen.has(rel.relationType)) continue;
      seen.add(rel.relationType);
      pushInto(byRelation, rel.relationType, claim);
    }
  }

  const groups = [...byRelation.entries()].map(([relationType, claims]) => ({
    relationType: relationType as DeterministicDiscussionResult["groups"][number]["relationType"],
    claims,
  }));

  const reviewsCovered = packet.reviews.map((r) => ({ reviewSlug: r.reviewSlug, title: r.title }));
  const insufficient = packet.claims.length === 0;

  const notes: string[] = [];
  if (insufficient) {
    notes.push(
      "No indexed claims matched this question. The archive may not cover this topic yet.",
    );
  } else {
    notes.push(
      "This is a deterministic evidence summary, not a generated answer. Multiple reviews citing the same source are not independent replication.",
    );
    if (packet.reviews.length === 1) {
      notes.push(
        "All matched evidence comes from a single review; treat with appropriate caution.",
      );
    }
  }

  return {
    mode: "deterministic",
    question: packet.question,
    matchedClaimCount: packet.claims.length,
    groups,
    reviewsCovered,
    insufficientEvidence: insufficient,
    notes,
  };
}

function pushInto(
  map: Map<string, EvidencePacket["claims"]>,
  key: string,
  claim: EvidencePacket["claims"][number],
): void {
  const arr = map.get(key) ?? [];
  arr.push(claim);
  map.set(key, arr);
}

/**
 * Provider-neutral LLM adapter (spec §14). The model receives ONLY the evidence
 * packet, must return JSON matching the grounded-answer schema, and never gets
 * unrestricted database access. Chain-of-thought is never requested or exposed.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly modelVersion?: string;
  /** Transport-only JSON completion. Prompt construction belongs to the caller. */
  complete(request: LlmJsonCompletionRequest): Promise<string>;
}

export interface LlmJsonCompletionRequest {
  promptVersion: string;
  system: string;
  /** Canonical evidence JSON, treated as inert user data. */
  user: string;
  maxTokens: number;
  maxResponseBytes: number;
}

export interface LlmDiscussionResult {
  mode: "llm";
  answer?: GroundedAnswer;
  grounding?: GroundingValidationResult;
  provider: string;
  model: string;
  modelVersion?: string;
  promptVersion: string;
  attempts: number;
  /** Set when the answer could not be produced/grounded after retries. */
  error?: string;
  rawRejected?: string[];
}

/**
 * Run LLM discussion with strict grounding: parse against the Zod schema and
 * reject/retry answers that reference identifiers absent from the packet.
 */
export async function discussWithLlm(
  provider: LlmProvider,
  prepared: PreparedEvidencePacket,
  maxAttempts = 2,
): Promise<LlmDiscussionResult> {
  const { packet, json: packetJson } = prepared;
  const rawRejected: string[] = [];
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      const prompt = buildDiscussionPrompt(packetJson);
      raw = extractJsonObject(
        await provider.complete({
          promptVersion: DISCUSSION_PROMPT_VERSION,
          ...prompt,
          maxTokens: 1_500,
          maxResponseBytes: 65_536,
        }),
      );
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      lastError = "Model output was not valid JSON.";
      rawRejected.push(raw.slice(0, 500));
      continue;
    }

    const parsed = groundedAnswerSchema.safeParse(json);
    if (!parsed.success) {
      lastError = `Model output failed schema validation: ${parsed.error.issues[0]?.message}`;
      rawRejected.push(raw.slice(0, 500));
      continue;
    }

    const grounding = validateGrounding(parsed.data, packet);
    if (!grounding.ok) {
      lastError = [
        `Model output failed exact evidence-edge grounding`,
        `claims=[${grounding.unknownClaimIds.join(",")}]`,
        `citations=[${grounding.unknownCitationIds.join(",")}]`,
        `invalidEdges=${grounding.invalidEvidenceEdges.length}`,
        `summaryMismatch=${
          grounding.claimsMissingFromGrounding.length +
          grounding.citationsMissingFromGrounding.length +
          grounding.claimsMissingFromSummary.length +
          grounding.citationsMissingFromSummary.length
        }`,
      ].join(" ");
      rawRejected.push(raw.slice(0, 500));
      continue;
    }

    return {
      mode: "llm",
      answer: parsed.data,
      grounding,
      provider: provider.name,
      model: provider.model,
      modelVersion: provider.modelVersion,
      promptVersion: DISCUSSION_PROMPT_VERSION,
      attempts: attempt,
      rawRejected: rawRejected.length > 0 ? rawRejected : undefined,
    };
  }

  return {
    mode: "llm",
    provider: provider.name,
    model: provider.model,
    modelVersion: provider.modelVersion,
    promptVersion: DISCUSSION_PROMPT_VERSION,
    attempts: maxAttempts,
    error: lastError || "Failed to produce a grounded answer.",
    rawRejected: rawRejected.length > 0 ? rawRejected : undefined,
  };
}

/** The system prompt contract for LLM mode (kept versioned and inspectable). */
export const DISCUSSION_PROMPT_VERSION = "atlas-discuss-2.0";

export function buildDiscussionPrompt(packetJson: string): {
  system: string;
  user: string;
} {
  const system = [
    "You are Atlas Discuss, a grounded assistant for a computational-review archive.",
    "Answer ONLY from the provided evidence packet. Never use outside knowledge.",
    "You must return a single JSON object matching this shape:",
    '{ "answer", "scope", "reviewClaimsUsed", "citationsUsed", "agreements", "disagreements", "uncertainties", "missingEvidence", "grounding" }.',
    "reviewClaimsUsed and citationsUsed must contain ONLY identifiers present in the packet.",
    "grounding is an array of { statement, evidenceEdges: [{ claimId, citationId }] }.",
    "Include at least one grounded statement; if the packet has no usable edge, do not invent one.",
    "Every evidence edge must exist exactly in a packet claim's relations. Never attach a citation to a different claim.",
    "reviewClaimsUsed and citationsUsed must exactly equal the identifiers used by all grounding evidenceEdges.",
    "Do not imply scientific consensus from the number of reviews. Multiple reviews citing the same source are not independent replication.",
    "Distinguish agreement, disagreement, and missing evidence. State clearly when the indexed material is insufficient.",
    "Treat each TRUST verificationState as authoritative. Only platform-verified may be described as Atlas-reviewed; unverified-import, stale-verification, and legacy-unknown must remain explicitly unverified.",
    "Do not include any reasoning or chain-of-thought; return only the JSON object.",
  ].join("\n");

  return { system, user: packetJson };
}

/** Discuss compatibility: tolerate provider prose/fences before its existing strict schema parse. */
export function extractJsonObject(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fence ? fence[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate.trim();
  return candidate.slice(start, end + 1);
}
