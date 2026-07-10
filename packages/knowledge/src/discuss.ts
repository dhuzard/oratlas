import {
  groundedAnswerSchema,
  validateGrounding,
  type DeterministicDiscussionResult,
  type EvidencePacket,
  type GroundedAnswer,
  type GroundingValidationResult,
} from "@oratlas/contracts";

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
    notes.push("No indexed claims matched this question. The archive may not cover this topic yet.");
  } else {
    notes.push(
      "This is a deterministic evidence summary, not a generated answer. Multiple reviews citing the same source are not independent replication.",
    );
    if (packet.reviews.length === 1) {
      notes.push("All matched evidence comes from a single review; treat with appropriate caution.");
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
  readonly promptVersion: string;
  /** Return raw JSON text for the grounded-answer schema, given the packet. */
  complete(packet: EvidencePacket): Promise<string>;
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
  packet: EvidencePacket,
  maxAttempts = 2,
): Promise<LlmDiscussionResult> {
  const rawRejected: string[] = [];
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await provider.complete(packet);
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
      lastError = `Model referenced unknown identifiers: claims=[${grounding.unknownClaimIds.join(",")}] citations=[${grounding.unknownCitationIds.join(",")}]`;
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
      promptVersion: provider.promptVersion,
      attempts: attempt,
      rawRejected: rawRejected.length > 0 ? rawRejected : undefined,
    };
  }

  return {
    mode: "llm",
    provider: provider.name,
    model: provider.model,
    modelVersion: provider.modelVersion,
    promptVersion: provider.promptVersion,
    attempts: maxAttempts,
    error: lastError || "Failed to produce a grounded answer.",
    rawRejected: rawRejected.length > 0 ? rawRejected : undefined,
  };
}

/** The system prompt contract for LLM mode (kept versioned and inspectable). */
export const DISCUSSION_PROMPT_VERSION = "atlas-discuss-1.0";

export function buildDiscussionPrompt(packet: EvidencePacket): {
  system: string;
  user: string;
} {
  const system = [
    "You are Atlas Discuss, a grounded assistant for a computational-review archive.",
    "Answer ONLY from the provided evidence packet. Never use outside knowledge.",
    "You must return a single JSON object matching this shape:",
    '{ "answer", "scope", "reviewClaimsUsed", "citationsUsed", "agreements", "disagreements", "uncertainties", "missingEvidence", "grounding" }.',
    "reviewClaimsUsed and citationsUsed must contain ONLY identifiers present in the packet.",
    "grounding is an array of { statement, claimIds, citationIds } tying each statement to packet identifiers.",
    "Do not imply scientific consensus from the number of reviews. Multiple reviews citing the same source are not independent replication.",
    "Distinguish agreement, disagreement, and missing evidence. State clearly when the indexed material is insufficient.",
    "Note whether supporting TRUST assessments are agent-proposed or human-reviewed.",
    "Do not include any reasoning or chain-of-thought; return only the JSON object.",
  ].join("\n");

  const user = JSON.stringify(packet);
  return { system, user };
}
