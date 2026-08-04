import "server-only";
import {
  buildEvidencePacket,
  discussDeterministic,
  discussWithLlm,
  prepareEvidencePacket,
  type LlmDiscussionResult,
} from "@oratlas/knowledge";
import { type DeterministicDiscussionResult } from "@oratlas/contracts";
import { buildKnowledgeIndex } from "./index-builder";
import { prisma } from "./db";
import { resolveLlmProvider } from "./llm-credentials";

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
      llmAvailable: false;
      llmSource: "none";
    } & DiscussionProvenance)
  | ({
      mode: "llm";
      result: LlmDiscussionResult;
      deterministic: DeterministicDiscussionResult;
      llmSource: "byok" | "platform";
    } & DiscussionProvenance);

/**
 * Run Atlas Discuss over accepted reviews. Deterministic mode is used when
 * neither a browser BYOK credential nor a platform provider is configured. The
 * deterministic summary is always computed and returned alongside LLM output.
 */
export async function runDiscussion(
  question: string,
  reviewSlugs?: string[],
): Promise<DiscussionResponse> {
  const index = await buildKnowledgeIndex();
  const packet = buildEvidencePacket(index, question, { reviewSlugs });
  const prepared = prepareEvidencePacket(packet);
  const deterministic = discussDeterministic(packet);
  const provenance = {
    packetHash: prepared.sha256,
    packetSchemaVersion: prepared.packet.schemaVersion,
    references: discussionReferences(prepared.packet),
  };
  const resolved = await resolveLlmProvider();

  if (!resolved) {
    return {
      mode: "deterministic",
      result: deterministic,
      llmAvailable: false,
      llmSource: "none",
      ...provenance,
    };
  }

  const startedAt = new Date();
  const result = await discussWithLlm(resolved.provider, prepared);

  // Persist the run and exact evidence bytes, never the browser or platform key.
  await prisma.agentRun.create({
    data: {
      agentType: "discussion-answer",
      modelProvider: result.provider,
      modelName: result.model,
      modelVersion: result.modelVersion,
      promptVersion: result.promptVersion,
      inputHash: prepared.sha256,
      inputReferencesJson: prepared.json,
      outputJson: result.answer ? JSON.stringify(result.answer) : undefined,
      status: result.answer ? "succeeded" : "failed",
      startedAt,
      completedAt: new Date(),
      error: result.error,
    },
  });

  return {
    mode: "llm",
    result,
    deterministic,
    llmSource: resolved.source,
    ...provenance,
  };
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
