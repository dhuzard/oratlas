import "server-only";
import { getServerEnv } from "@oratlas/config";
import {
  buildEvidencePacket,
  createAnthropicProvider,
  discussDeterministic,
  discussWithLlm,
  hashEvidencePacket,
  type LlmDiscussionResult,
} from "@oratlas/knowledge";
import { type DeterministicDiscussionResult } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "./index-builder";
import { prisma } from "./db";

export type DiscussionResponse =
  | { mode: "deterministic"; result: DeterministicDiscussionResult; llmAvailable: boolean }
  | { mode: "llm"; result: LlmDiscussionResult; deterministic: DeterministicDiscussionResult };

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
  const deterministic = discussDeterministic(packet);

  if (!env.llmEnabled || !env.ANTHROPIC_API_KEY) {
    return { mode: "deterministic", result: deterministic, llmAvailable: false };
  }

  const provider = createAnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.LLM_MODEL,
  });

  const startedAt = new Date();
  const result = await discussWithLlm(provider, packet);
  const packetHash = hashEvidencePacket(packet);

  // Persist the agent run for provenance (spec §14).
  await prisma.agentRun.create({
    data: {
      agentType: "discussion-answer",
      modelProvider: result.provider,
      modelName: result.model,
      modelVersion: result.modelVersion,
      promptVersion: result.promptVersion,
      inputHash: packetHash,
      inputReferencesJson: JSON.stringify({
        claimIds: packet.claims.map((c) => c.claimId),
        citationIds: packet.citations.map((c) => c.citationId),
      }),
      outputJson: result.answer ? JSON.stringify(result.answer) : undefined,
      status: result.answer ? "succeeded" : "failed",
      startedAt,
      completedAt: new Date(),
      error: result.error,
    },
  });

  return { mode: "llm", result, deterministic };
}
