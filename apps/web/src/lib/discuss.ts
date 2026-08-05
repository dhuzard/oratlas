import "server-only";
import { getServerEnv } from "@oratlas/config";
import {
  createAnthropicProvider,
  createOpenAIProvider,
  discussDeterministic,
  discussWithLlm,
  prepareEvidencePacket,
  type LlmDiscussionResult,
  type LlmProvider,
} from "@oratlas/knowledge";
import {
  type DeterministicDiscussionResult,
  type DiscussionTraversalScope,
} from "@oratlas/contracts";
import { buildKnowledgeIndex } from "./index-builder";
import { prisma } from "./db";
import { selectDiscussionEvidence, type ResolvedDiscussionScope } from "./discussion-scope";

export interface DiscussionReference {
  kind: "claim" | "citation";
  id: string;
  label: string;
  href: string;
  landscapeNodeId: string;
}

interface DiscussionProvenance {
  packetHash: string;
  packetSchemaVersion: "1.1.0";
  references: DiscussionReference[];
  scope: ResolvedDiscussionScope;
}

export interface RequestLlmConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model?: string;
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
 * Run Atlas Discuss over a signed exact Explore traversal. Deterministic mode
 * is used when no LLM key is configured; LLM mode remains grounded and
 * identifier-validated. The deterministic summary is always returned too.
 */
export async function runDiscussion(
  question: string,
  traversalScope: DiscussionTraversalScope,
  requestLlm?: RequestLlmConfig,
): Promise<DiscussionResponse> {
  const env = getServerEnv();
  const index = await buildKnowledgeIndex();
  const selection = await selectDiscussionEvidence(index, question, traversalScope);
  const packet = selection.packet;
  const prepared = prepareEvidencePacket(packet);
  const deterministic = discussDeterministic(packet);
  const provenance = {
    packetHash: prepared.sha256,
    packetSchemaVersion: prepared.packet.schemaVersion,
    references: discussionReferences(prepared.packet, selection.scope),
    scope: selection.scope,
  };

  let provider: LlmProvider | undefined;
  if (requestLlm) {
    provider =
      requestLlm.provider === "anthropic"
        ? createAnthropicProvider({
            apiKey: requestLlm.apiKey,
            model: requestLlm.model,
          })
        : createOpenAIProvider({
            apiKey: requestLlm.apiKey,
            model: requestLlm.model,
          });
  } else if (env.llmEnabled && env.ANTHROPIC_API_KEY) {
    provider = createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.LLM_MODEL,
    });
  }

  if (!provider) {
    return {
      mode: "deterministic",
      result: deterministic,
      llmAvailable: false,
      ...provenance,
    };
  }

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

export function discussionReferences(
  packet: Parameters<typeof prepareEvidencePacket>[0],
  scope: ResolvedDiscussionScope,
): DiscussionReference[] {
  const claimHref = (claim: (typeof packet.claims)[number]) =>
    `/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`;
  const claims: DiscussionReference[] = packet.claims.map((claim) => {
    const exactLandscapeNodeId = scope.claimLandscapeNodeIds[claim.claimId];
    if (scope.kind === "explore" && !exactLandscapeNodeId) {
      throw new Error(`Missing exact graph reference for selected claim '${claim.claimId}'.`);
    }
    return {
      kind: "claim",
      id: claim.claimId,
      label: claim.text,
      href: claimHref(claim),
      landscapeNodeId: exactLandscapeNodeId ?? `claim:${claim.claimId}`,
    };
  });
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
            href: `${claimHref(claim)}#linked-evidence`,
            landscapeNodeId: exactCitationLandscapeNodeId(
              scope,
              citation.citationId,
              citation.workId,
            ),
          },
        ]
      : [];
  });
  return [...claims, ...citations];
}

function exactCitationLandscapeNodeId(
  scope: ResolvedDiscussionScope,
  citationId: string,
  workId: string,
): string {
  const exactLandscapeNodeId = scope.citationLandscapeNodeIds[citationId];
  if (scope.kind === "explore" && !exactLandscapeNodeId) {
    throw new Error(`Missing exact graph reference for selected citation '${citationId}'.`);
  }
  return exactLandscapeNodeId ?? `evidence:${workId}`;
}
