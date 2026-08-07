import "server-only";
import { createHash } from "node:crypto";
import {
  graphCurationPacketSchema,
  knowledgeNodeKindSchema,
  type GraphCurationCandidate,
  type GraphCurationPacket,
  type KnowledgeLandscapeQuery,
  type KnowledgeLandscapeResponse,
  type RequestLlmConfig,
} from "@oratlas/contracts";
import {
  canonicalJson,
  createAnthropicProvider,
  createOpenAIProvider,
  proposeGraphCuration,
  type LlmProvider,
} from "@oratlas/knowledge";
import { prisma } from "./db";
import { createKnowledgeLandscapeResponse } from "./knowledge-landscape-service";
import { createAgentNodeEdgeProposal } from "./node-edge-lifecycle";

export async function runGraphCuration(
  question: string,
  scope: KnowledgeLandscapeQuery,
  requestLlm: RequestLlmConfig,
) {
  const landscape = await createKnowledgeLandscapeResponse(scope);
  const packet = buildGraphCurationPacket(question, landscape);
  const packetJson = canonicalJson(packet);
  const packetHash = createHash("sha256").update(packetJson).digest("hex");
  const result = await proposeGraphCuration(providerFor(requestLlm), packet);
  if (!result.output) {
    return { created: [], packetHash, error: result.error ?? "No valid proposals." };
  }

  const created: Array<{ proposalId: string; idempotent: boolean }> = [];
  for (const candidate of result.output.proposals) {
    const evidence = { landscapeNodeIds: candidate.evidenceNodeIds, packetHash };
    const runCandidate = await prepareRunCandidate(candidate, evidence);
    const candidateJson = canonicalJson(runCandidate);
    const candidateHash = createHash("sha256").update(candidateJson).digest("hex");
    const run = await prisma.agentRun.create({
      data: {
        agentType: "node-edge-proposal",
        modelProvider: result.provider,
        modelName: result.model,
        modelVersion: result.modelVersion,
        promptVersion: result.promptVersion,
        packetHash,
        inputHash: packetHash,
        inputReferencesJson: packetJson,
        outputJson: canonicalJson({ candidate: runCandidate, candidateHash }),
        status: "succeeded",
        completedAt: new Date(),
      },
    });
    created.push(
      await createAgentNodeEdgeProposal({
        agentRunId: run.id,
        sourceNodeVersionId: candidate.sourceNodeVersionId,
        targetNodeVersionId: candidate.targetNodeVersionId,
        relationType: candidate.relationType,
        rationale: candidate.rationale,
        evidence,
      }),
    );
  }
  return { created, packetHash };
}

export function buildGraphCurationPacket(
  question: string,
  response: KnowledgeLandscapeResponse,
): GraphCurationPacket {
  const nodes = response.landscape.nodes.flatMap((node) =>
    node.graphNodeId &&
    node.graphNodeVersionId &&
    node.kind !== "review" &&
    node.kind !== "evidence"
      ? [
          {
            landscapeNodeId: node.id,
            nodeId: node.graphNodeId,
            nodeVersionId: node.graphNodeVersionId,
            kind: knowledgeNodeKindSchema.parse(node.kind),
            title: node.label,
          },
        ]
      : [],
  );
  const versionByLandscapeId = new Map(
    nodes.map((node) => [node.landscapeNodeId, node.nodeVersionId]),
  );
  const confirmedEdges = response.landscape.edges.flatMap((edge) => {
    const sourceNodeVersionId = versionByLandscapeId.get(edge.sourceId);
    const targetNodeVersionId = versionByLandscapeId.get(edge.targetId);
    return edge.status === "confirmed" && sourceNodeVersionId && targetNodeVersionId
      ? [{ sourceNodeVersionId, targetNodeVersionId, relationType: edge.relationType }]
      : [];
  });
  return graphCurationPacketSchema.parse({
    schemaVersion: "1.0.0",
    question,
    nodes,
    confirmedEdges,
  });
}

function providerFor(config: RequestLlmConfig): LlmProvider {
  return config.provider === "anthropic"
    ? createAnthropicProvider({ apiKey: config.apiKey, model: config.model })
    : createOpenAIProvider({ apiKey: config.apiKey, model: config.model });
}

async function prepareRunCandidate(candidate: GraphCurationCandidate, evidence: unknown) {
  const [source, target] = await Promise.all(
    [candidate.sourceNodeVersionId, candidate.targetNodeVersionId].map((id) =>
      prisma.knowledgeNodeVersion.findUnique({
        where: { id },
        include: { knowledgeNode: { include: { repository: true } }, snapshot: true },
      }),
    ),
  );
  if (
    !source?.knowledgeNode.repository ||
    !source.snapshot ||
    !target?.knowledgeNode.repository ||
    !target.snapshot
  ) {
    throw new Error("A selected repository-backed node version is no longer available.");
  }
  const stableKey = (row: typeof source) => {
    if (!row.knowledgeNode.repository || !row.snapshot) {
      throw new Error("A repository-backed node version lost its source identity.");
    }
    return canonicalJson({
      githubRepositoryId: row.knowledgeNode.repository.githubRepositoryId,
      localNodeId: row.knowledgeNode.localNodeId,
      commitSha: row.snapshot.commitSha.toLowerCase(),
    });
  };
  return {
    sourceStableKey: stableKey(source),
    targetStableKey: stableKey(target),
    relationType: candidate.relationType,
    rationale: candidate.rationale,
    evidence,
  };
}
