import "server-only";
import { canonicalJson } from "@oratlas/contracts";
import {
  GRAPH_CURATION_PROMPT_VERSION,
  curateGraphRelation,
  prepareGraphCurationPacket,
} from "@oratlas/knowledge";
import { prisma } from "./db";
import { sha256 } from "./hash";
import { resolveLlmProvider } from "./llm-credentials";
import { createAgentNodeEdgeProposal } from "./node-edge-lifecycle";
import { getPublicNode } from "./node-publication";

export class AiGraphCurationError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "not-found" | "conflict" | "upstream-error",
  ) {
    super(message);
    this.name = "AiGraphCurationError";
  }
}

export type AiGraphCurationOutcome =
  | {
      status: "proposed";
      agentRunId: string;
      proposalId: string;
      idempotent: boolean;
      relationType: string;
      rationale: string;
    }
  | {
      status: "abstained";
      agentRunId: string;
      reason: string;
      missingEvidence: string[];
    };

export async function proposeGraphEdgeWithAi(input: {
  actorId: string;
  sourceNodeId: string;
  targetNodeId: string;
  instruction?: string;
}): Promise<AiGraphCurationOutcome> {
  if (input.sourceNodeId === input.targetNodeId) {
    throw new AiGraphCurationError("Source and target nodes must be different.", "bad-request");
  }
  const resolved = await resolveLlmProvider();
  if (!resolved) {
    throw new AiGraphCurationError(
      "Connect an Anthropic or OpenAI provider before requesting AI graph curation.",
      "conflict",
    );
  }

  const [sourcePublic, targetPublic] = await Promise.all([
    getPublicNode(input.sourceNodeId),
    getPublicNode(input.targetNodeId),
  ]);
  if (!sourcePublic || !targetPublic) {
    throw new AiGraphCurationError(
      "Both stable node IDs must resolve to readable public node versions.",
      "not-found",
    );
  }
  const [sourceStored, targetStored] = await Promise.all([
    loadStoredVersion(sourcePublic.version.id, sourcePublic.id),
    loadStoredVersion(targetPublic.version.id, targetPublic.id),
  ]);

  const prepared = prepareGraphCurationPacket({
    source: packetNode(sourcePublic),
    target: packetNode(targetPublic),
    userInstruction: input.instruction?.trim() || undefined,
  });
  const startedAt = new Date();
  const run = await prisma.agentRun.create({
    data: {
      agentType: "node-edge-proposal",
      modelProvider: resolved.provider.name,
      modelName: resolved.provider.model,
      modelVersion: resolved.provider.modelVersion,
      promptVersion: GRAPH_CURATION_PROMPT_VERSION,
      packetHash: prepared.sha256,
      inputHash: prepared.sha256,
      inputReferencesJson: prepared.json,
      status: "running",
      startedAt,
    },
  });

  const result = await curateGraphRelation(resolved.provider, prepared);
  if (!result.decision) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: sanitizeFailure(result.error),
      },
    });
    throw new AiGraphCurationError(
      "The provider did not return a valid, source-grounded relation proposal.",
      "upstream-error",
    );
  }

  if (result.decision.decision === "abstain") {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        outputJson: canonicalJson(result.decision),
      },
    });
    return {
      status: "abstained",
      agentRunId: run.id,
      reason: result.decision.reason,
      missingEvidence: result.decision.missingEvidence,
    };
  }

  const candidate = {
    sourceStableKey: stableNodeVersionKey(sourceStored),
    targetStableKey: stableNodeVersionKey(targetStored),
    relationType: result.decision.relationType,
    rationale: result.decision.rationale,
    evidence: {
      ...result.decision.evidence,
      packetHash: prepared.sha256,
      requestedByUserId: input.actorId,
      sourceNodeVersionId: sourcePublic.version.id,
      targetNodeVersionId: targetPublic.version.id,
    },
  };
  const candidateJson = canonicalJson(candidate);
  const candidateHash = sha256(candidateJson);
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: "succeeded",
      completedAt: new Date(),
      outputJson: canonicalJson({ candidate, candidateHash }),
    },
  });
  const proposal = await createAgentNodeEdgeProposal({
    agentRunId: run.id,
    sourceNodeVersionId: sourcePublic.version.id,
    targetNodeVersionId: targetPublic.version.id,
    relationType: result.decision.relationType,
    rationale: result.decision.rationale,
    evidence: candidate.evidence,
  });
  return {
    status: "proposed",
    agentRunId: run.id,
    proposalId: proposal.proposalId,
    idempotent: proposal.idempotent,
    relationType: result.decision.relationType,
    rationale: result.decision.rationale,
  };
}

async function loadStoredVersion(versionId: string, nodeId: string) {
  const version = await prisma.knowledgeNodeVersion.findFirst({
    where: { id: versionId, knowledgeNodeId: nodeId },
    include: { knowledgeNode: { include: { repository: true } }, snapshot: true },
  });
  if (!version || !version.knowledgeNode.repository.githubRepositoryId) {
    throw new AiGraphCurationError(
      "The exact public node version lacks an immutable GitHub repository identity.",
      "conflict",
    );
  }
  return version;
}

function packetNode(node: NonNullable<Awaited<ReturnType<typeof getPublicNode>>>) {
  return {
    nodeId: node.id,
    versionId: node.version.id,
    kind: node.kind,
    repository: node.repository.url,
    commitSha: node.version.commitSha,
    title: node.version.title,
    abstract: node.version.abstract,
    text: node.version.text?.slice(0, 30_000),
    payload: node.version.payload,
  };
}

function stableNodeVersionKey(version: Awaited<ReturnType<typeof loadStoredVersion>>): string {
  return canonicalJson({
    githubRepositoryId: version.knowledgeNode.repository.githubRepositoryId,
    localNodeId: version.knowledgeNode.localNodeId,
    commitSha: version.snapshot.commitSha.toLowerCase(),
  });
}

function sanitizeFailure(message: string | undefined): string {
  return (message ?? "Invalid provider output.").slice(0, 1_000);
}
