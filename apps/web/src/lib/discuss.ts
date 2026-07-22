import "server-only";
import { getServerEnv } from "@oratlas/config";
import {
  buildEvidencePacket,
  createAnthropicProvider,
  discussDeterministic,
  discussWithLlm,
  prepareEvidencePacket,
  type LlmDiscussionResult,
} from "@oratlas/knowledge";
import { type DeterministicDiscussionResult } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "./index-builder";
import { prisma } from "./db";

export interface DiscussionReference {
  kind: "claim" | "citation";
  id: string;
  label: string;
  href: string;
}

interface DiscussionProvenance {
  packetHash: string;
  packetSchemaVersion: "1.1.0";
  references: DiscussionReference[];
}

export type DiscussionResponse =
  | ({
      mode: "deterministic";
      result: DeterministicDiscussionResult;
      llmAvailable: boolean;
    } & DiscussionProvenance)
  | ({
      mode: "llm";
      result: LlmDiscussionResult;
      deterministic: DeterministicDiscussionResult;
    } & DiscussionProvenance);

/**
 * Run Atlas Discuss over accepted reviews. Deterministic mode when no LLM key
 * is configured; LLM mode (grounded, identifier-validated) when configured. The
 * deterministic summary is always computed and returned alongside LLM output.
 */
export async function runDiscussion(
  question: string,
  reviewSlugs?: string[],
): Promise<DiscussionResponse> {
  const env = getServerEnv();
  const index = await buildKnowledgeIndex();
  const packet = buildEvidencePacket(index, question, { reviewSlugs });
  const prepared = prepareEvidencePacket(packet);
  const deterministic = discussDeterministic(packet);
  const provenance = {
    packetHash: prepared.sha256,
    packetSchemaVersion: prepared.packet.schemaVersion,
    references: discussionReferences(prepared.packet),
  };

  if (!env.llmEnabled || !env.ANTHROPIC_API_KEY) {
    return { mode: "deterministic", result: deterministic, llmAvailable: false, ...provenance };
  }

  const provider = createAnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.LLM_MODEL,
  });

  const startedAt = new Date();
  const result = await discussWithLlm(provider, prepared);

  // Persist the agent run for provenance (spec §14).
  await prisma.agentRun.create({
    data: {
      agentType: "discussion-answer",
      modelProvider: result.provider,
      modelName: result.model,
      modelVersion: result.modelVersion,
      promptVersion: result.promptVersion,
      inputHash: prepared.sha256,
      // The exact canonical bytes hashed above and sent to the provider.
      inputReferencesJson: prepared.json,
      outputJson: result.answer ? JSON.stringify(result.answer) : undefined,
      status: result.answer ? "succeeded" : "failed",
      startedAt,
      completedAt: new Date(),
      error: result.error,
    },
  });

  return { mode: "llm", result, deterministic, ...provenance };
}

function discussionReferences(
  packet: ReturnType<typeof buildEvidencePacket>,
): DiscussionReference[] {
  const claimHref = (claim: (typeof packet.claims)[number]) =>
    `/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`;
  const claims: DiscussionReference[] = packet.claims.map((claim) => ({
    kind: "claim",
    id: claim.claimId,
    label: claim.text,
    href: claimHref(claim),
  }));
  const citations: DiscussionReference[] = packet.citations.flatMap((citation) => {
    const claim = packet.claims.find((candidate) =>
      candidate.relations.some((relation) => relation.citationId === citation.citationId),
    );
    return claim
      ? [
          {
            kind: "citation" as const,
            id: citation.citationId,
            label: citation.title ?? citation.localCitationId,
            href: claimHref(claim),
          },
        ]
      : [];
  });
  return [...claims, ...citations];
}
