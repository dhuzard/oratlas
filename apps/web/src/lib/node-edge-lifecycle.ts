import "server-only";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  knowledgeNodeKindSchema,
  nodeEdgeDecisionSchema,
  nodeEdgeStatusSchema,
  nodeRelationTypeSchema,
  type NodeEdgeDecision,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import {
  NodeEdgeTransitionError,
  prepareNodeEdgeProposal,
  transitionNodeEdgeProposal,
} from "@oratlas/knowledge";
import { prisma } from "./db";
import { prismaCode, withSqliteRetry } from "./db-retry";

export class NodeEdgeLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "NodeEdgeLifecycleError";
  }
}

export interface NodeEdgeActor {
  id: string;
  role: string;
}

export interface AuthorEdgeRecord {
  status: string;
  sourcePath: string;
  sourcePointer: string;
  edge?: {
    sourceNodeId: string;
    targetNodeId: string;
    relationType: string;
    targetRepository?: { githubRepositoryId: string; commitSha: string };
    rationale?: string;
    assertedAt?: string;
  };
}

export interface SelectedNodeVersion {
  id: string;
  knowledgeNodeId: string;
  localNodeId: string;
  kind: string;
}

/** Create private author proposals only when both local endpoints were selected. */
export async function materializeAuthorEdgeProposals(
  tx: Prisma.TransactionClient,
  input: {
    submissionId: string;
    submitterId: string;
    inspectionCaptureId: string;
    capturePayloadHash: string;
    sourceRepositoryGithubId?: string | null;
    sourceCommitSha: string;
    edges: AuthorEdgeRecord[];
    selectedVersions: SelectedNodeVersion[];
  },
): Promise<string[]> {
  const selected = new Map(input.selectedVersions.map((version) => [version.localNodeId, version]));
  const proposalIds: string[] = [];
  for (const record of input.edges) {
    if (record.status !== "ok" || !record.edge) continue;
    const source = selected.get(record.edge.sourceNodeId);
    const localTarget = record.edge.targetRepository
      ? undefined
      : selected.get(record.edge.targetNodeId);
    // A local declaration never creates a dangling proposal to an excluded node.
    if (!source) continue;
    let target = localTarget;
    let targetRepositoryGithubId = input.sourceRepositoryGithubId ?? undefined;
    let targetCommitSha = input.sourceCommitSha;
    if (record.edge.targetRepository) {
      targetRepositoryGithubId = record.edge.targetRepository.githubRepositoryId;
      targetCommitSha = record.edge.targetRepository.commitSha;
      const matches = await tx.knowledgeNodeVersion.findMany({
        where: {
          knowledgeNode: {
            localNodeId: record.edge.targetNodeId,
            repository: { githubRepositoryId: targetRepositoryGithubId },
          },
          snapshot: { commitSha: targetCommitSha },
        },
        include: { knowledgeNode: true },
        take: 2,
      });
      if (matches.length !== 1) {
        throw new NodeEdgeLifecycleError(
          matches.length === 0
            ? "Cross-lab edge target was not found at the declared repository and commit."
            : "Cross-lab edge target resolved ambiguously.",
          "conflict",
        );
      }
      const match = matches[0]!;
      target = {
        id: match.id,
        knowledgeNodeId: match.knowledgeNodeId,
        localNodeId: match.knowledgeNode.localNodeId,
        kind: match.knowledgeNode.kind,
      };
    }
    if (!target) continue;
    if (!input.sourceRepositoryGithubId) {
      throw new NodeEdgeLifecycleError(
        "A materialized author edge requires an immutable source repository identity.",
        "conflict",
      );
    }
    targetRepositoryGithubId ??= input.sourceRepositoryGithubId;
    const prepared = prepareNodeEdgeProposal({
      sourceNodeId: source.knowledgeNodeId,
      sourceNodeVersionId: source.id,
      targetNodeId: target.knowledgeNodeId,
      targetNodeVersionId: target.id,
      sourceKind: knowledgeNodeKindSchema.parse(source.kind),
      targetKind: knowledgeNodeKindSchema.parse(target.kind),
      relationType: nodeRelationTypeSchema.parse(record.edge.relationType),
      origin: "asserted-by-author",
      originReference: `${input.capturePayloadHash}:${record.sourcePath}:${record.sourcePointer}`,
      sourceStableKey: stableNodeVersionKey(
        input.sourceRepositoryGithubId,
        source.localNodeId,
        input.sourceCommitSha,
      ),
      targetStableKey: stableNodeVersionKey(
        targetRepositoryGithubId,
        target.localNodeId,
        targetCommitSha,
      ),
      rationale: record.edge.rationale,
      evidence: {
        sourcePath: record.sourcePath,
        sourcePointer: record.sourcePointer,
        assertedAt: record.edge.assertedAt,
        capturePayloadHash: input.capturePayloadHash,
      },
    });
    const proposal = await tx.nodeEdgeProposal.create({
      data: {
        originKey: prepared.originKey,
        sourceStableKey: prepared.sourceStableKey,
        targetStableKey: prepared.targetStableKey,
        sourceNodeVersionId: prepared.sourceNodeVersionId,
        targetNodeId: prepared.targetNodeId,
        targetNodeVersionId: prepared.targetNodeVersionId,
        relationType: prepared.relationType,
        origin: prepared.origin,
        rationale: prepared.rationale,
        evidenceJson: prepared.evidenceJson,
        sourceSubmissionId: input.submissionId,
        inspectionCaptureId: input.inspectionCaptureId,
      },
    });
    await claimIdempotency(tx, `node-edge.asserted:${prepared.originKey}`);
    await tx.auditEvent.create({
      data: {
        actorId: input.submitterId,
        action: "node-edge.asserted",
        subjectType: "node-edge-proposal",
        subjectId: proposal.id,
        idempotencyKey: `node-edge.asserted:${prepared.originKey}`,
        detailsJson: canonicalJson({
          originKey: prepared.originKey,
          sourceNodeVersionId: source.id,
          targetNodeVersionId: target.id,
          relationType: prepared.relationType,
          capturePayloadHash: input.capturePayloadHash,
        }),
      },
    });
    proposalIds.push(proposal.id);
  }
  return proposalIds;
}

/** Persist a validated agent candidate without granting it public authority. */
export async function createAgentNodeEdgeProposal(input: {
  agentRunId: string;
  sourceNodeVersionId: string;
  targetNodeVersionId: string;
  relationType: string;
  rationale: string;
  evidence: unknown;
}): Promise<{ proposalId: string; idempotent: boolean }> {
  const [run, source, target] = await Promise.all([
    prisma.agentRun.findUnique({ where: { id: input.agentRunId } }),
    prisma.knowledgeNodeVersion.findUnique({
      where: { id: input.sourceNodeVersionId },
      include: { knowledgeNode: { include: { repository: true } }, snapshot: true },
    }),
    prisma.knowledgeNodeVersion.findUnique({
      where: { id: input.targetNodeVersionId },
      include: { knowledgeNode: { include: { repository: true } }, snapshot: true },
    }),
  ]);
  if (!run || run.status !== "succeeded") {
    throw new NodeEdgeLifecycleError("A succeeded AgentRun is required.", "conflict");
  }
  if (run.agentType !== "node-edge-proposal") {
    throw new NodeEdgeLifecycleError("The AgentRun is not a node-edge proposal run.", "conflict");
  }
  if (!source || !target) throw new NodeEdgeLifecycleError("Node version not found.", "not-found");
  if (
    !source.knowledgeNode.repository.githubRepositoryId ||
    !target.knowledgeNode.repository.githubRepositoryId
  ) {
    throw new NodeEdgeLifecycleError("Immutable repository identities are required.", "conflict");
  }
  const sourceStableKey = stableNodeVersionKey(
    source.knowledgeNode.repository.githubRepositoryId,
    source.knowledgeNode.localNodeId,
    source.snapshot.commitSha,
  );
  const targetStableKey = stableNodeVersionKey(
    target.knowledgeNode.repository.githubRepositoryId,
    target.knowledgeNode.localNodeId,
    target.snapshot.commitSha,
  );
  assertAgentRunCandidate(run.outputJson, {
    sourceStableKey,
    targetStableKey,
    relationType: input.relationType,
    rationale: input.rationale,
    evidence: input.evidence,
  });
  const prepared = prepareNodeEdgeProposal({
    sourceNodeId: source.knowledgeNodeId,
    sourceNodeVersionId: source.id,
    targetNodeId: target.knowledgeNodeId,
    targetNodeVersionId: target.id,
    sourceKind: knowledgeNodeKindSchema.parse(source.knowledgeNode.kind),
    targetKind: knowledgeNodeKindSchema.parse(target.knowledgeNode.kind),
    relationType: nodeRelationTypeSchema.parse(input.relationType),
    origin: "proposed-by-agent",
    originReference: run.id,
    sourceStableKey,
    targetStableKey,
    rationale: input.rationale,
    evidence: input.evidence,
  });
  const existing = await prisma.nodeEdgeProposal.findUnique({
    where: { originKey: prepared.originKey },
  });
  if (existing) {
    assertSameProposal(existing, prepared);
    return { proposalId: existing.id, idempotent: true };
  }
  try {
    return await withSqliteRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const proposal = await tx.nodeEdgeProposal.create({
              data: {
                originKey: prepared.originKey,
                sourceStableKey: prepared.sourceStableKey,
                targetStableKey: prepared.targetStableKey,
                sourceNodeVersionId: prepared.sourceNodeVersionId,
                targetNodeId: prepared.targetNodeId,
                targetNodeVersionId: prepared.targetNodeVersionId,
                relationType: prepared.relationType,
                origin: prepared.origin,
                rationale: prepared.rationale,
                evidenceJson: prepared.evidenceJson,
                agentRunId: run.id,
              },
            });
            await claimIdempotency(tx, `node-edge.proposed:${prepared.originKey}`);
            await tx.auditEvent.create({
              data: {
                action: "node-edge.proposed",
                subjectType: "node-edge-proposal",
                subjectId: proposal.id,
                idempotencyKey: `node-edge.proposed:${prepared.originKey}`,
                detailsJson: canonicalJson({
                  originKey: prepared.originKey,
                  agentRunId: run.id,
                  sourceNodeVersionId: prepared.sourceNodeVersionId,
                  targetNodeVersionId: prepared.targetNodeVersionId,
                  relationType: prepared.relationType,
                }),
              },
            });
            return { proposalId: proposal.id, idempotent: false };
          },
          { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
        ),
      (error) => error instanceof NodeEdgeLifecycleError,
    );
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      const concurrent = await prisma.nodeEdgeProposal.findUnique({
        where: { originKey: prepared.originKey },
      });
      if (concurrent) {
        assertSameProposal(concurrent, prepared);
        return { proposalId: concurrent.id, idempotent: true };
      }
    }
    throw error;
  }
}

export async function decideNodeEdgeProposal(
  actor: NodeEdgeActor,
  proposalId: string,
  decision: NodeEdgeDecision,
): Promise<{ status: string; revision: number; edgeId?: string; idempotent: boolean }> {
  const parsed = nodeEdgeDecisionSchema.parse(decision);
  await requireCurrentEditor(actor.id);
  const requested = decisionStatus(parsed.decision);
  const decide = () =>
    withSqliteRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const proposal = await tx.nodeEdgeProposal.findUnique({ where: { id: proposalId } });
            if (!proposal)
              throw new NodeEdgeLifecycleError("Edge proposal not found.", "not-found");
            const current = nodeEdgeStatusSchema.parse(proposal.status);
            if (current === requested) {
              if (
                proposal.reviewedById === actor.id &&
                proposal.reviewNote === parsed.note &&
                proposal.revision === parsed.expectedRevision + 1
              ) {
                return {
                  status: proposal.status,
                  revision: proposal.revision,
                  edgeId: proposal.confirmedEdgeId ?? undefined,
                  idempotent: true,
                };
              }
              throw new NodeEdgeLifecycleError(
                "Proposal already received a different decision.",
                "conflict",
              );
            }
            try {
              transitionNodeEdgeProposal(current, requested);
            } catch (error) {
              if (error instanceof NodeEdgeTransitionError) {
                throw new NodeEdgeLifecycleError(error.message, "conflict");
              }
              throw error;
            }
            if (proposal.revision !== parsed.expectedRevision) {
              throw new NodeEdgeLifecycleError(
                "Proposal revision changed concurrently.",
                "conflict",
              );
            }
            let edgeId = proposal.confirmedEdgeId ?? undefined;
            if (requested === "confirmed") {
              const existingEdge = await tx.nodeEdge.findUnique({
                where: {
                  sourceNodeVersionId_targetNodeId_relationType: {
                    sourceNodeVersionId: proposal.sourceNodeVersionId,
                    targetNodeId: proposal.targetNodeId,
                    relationType: proposal.relationType,
                  },
                },
                include: { confirmedBy: { select: { role: true } } },
              });
              if (existingEdge && existingEdge.status !== "confirmed") {
                throw new NodeEdgeLifecycleError(
                  "Only an already-confirmed edge can be reused by another proposal.",
                  "conflict",
                );
              }
              if (
                existingEdge?.confirmedTargetNodeVersionId &&
                existingEdge.confirmedTargetNodeVersionId !== proposal.targetNodeVersionId
              ) {
                throw new NodeEdgeLifecycleError(
                  "The existing edge was confirmed against a different target version.",
                  "conflict",
                );
              }
              const edge = existingEdge
                ? existingEdge.confirmedTargetNodeVersionId &&
                  existingEdge.confirmedById &&
                  existingEdge.confirmedAt &&
                  existingEdge.provenance === "confirmed-by-editor" &&
                  isEditorialRole(existingEdge.confirmedBy?.role)
                  ? existingEdge
                  : await tx.nodeEdge.update({
                      where: { id: existingEdge.id },
                      data: {
                        provenance: "confirmed-by-editor",
                        confirmedTargetNodeVersionId: proposal.targetNodeVersionId,
                        confirmedById: actor.id,
                        confirmedAt: new Date(),
                        revision: { increment: 1 },
                      },
                    })
                : await tx.nodeEdge.create({
                    data: {
                      sourceNodeVersionId: proposal.sourceNodeVersionId,
                      targetNodeId: proposal.targetNodeId,
                      relationType: proposal.relationType,
                      status: "confirmed",
                      provenance: "confirmed-by-editor",
                      rationale: proposal.rationale,
                      confirmedTargetNodeVersionId: proposal.targetNodeVersionId,
                      confirmedById: actor.id,
                      confirmedAt: new Date(),
                    },
                  });
              edgeId = edge.id;
            }
            if (requested === "superseded" && proposal.confirmedEdgeId) {
              const otherConfirmations = await tx.nodeEdgeProposal.count({
                where: {
                  confirmedEdgeId: proposal.confirmedEdgeId,
                  status: "confirmed",
                  id: { not: proposal.id },
                },
              });
              if (otherConfirmations === 0) {
                await tx.nodeEdge.updateMany({
                  where: { id: proposal.confirmedEdgeId, status: "confirmed" },
                  data: { status: "superseded", revision: { increment: 1 } },
                });
              }
            }
            const changed = await tx.nodeEdgeProposal.updateMany({
              where: {
                id: proposal.id,
                status: proposal.status,
                revision: parsed.expectedRevision,
              },
              data: {
                status: requested,
                revision: { increment: 1 },
                reviewedById: actor.id,
                reviewedAt: new Date(),
                reviewNote: parsed.note,
                confirmedEdgeId: edgeId,
              },
            });
            if (changed.count !== 1) {
              throw new NodeEdgeLifecycleError(
                "Proposal decision changed concurrently.",
                "conflict",
              );
            }
            const nextRevision = parsed.expectedRevision + 1;
            const idempotencyKey = `node-edge.${requested}:${proposal.id}:${nextRevision}`;
            await claimIdempotency(tx, idempotencyKey);
            await tx.auditEvent.create({
              data: {
                actorId: actor.id,
                action: `node-edge.${requested}`,
                subjectType: "node-edge-proposal",
                subjectId: proposal.id,
                idempotencyKey,
                detailsJson: canonicalJson({
                  fromStatus: proposal.status,
                  toStatus: requested,
                  revision: nextRevision,
                  edgeId,
                  note: parsed.note,
                }),
              },
            });
            return { status: requested, revision: nextRevision, edgeId, idempotent: false };
          },
          { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
        ),
      (error) => error instanceof NodeEdgeLifecycleError,
    );
  try {
    return await decide();
  } catch (error) {
    if (requested !== "confirmed" || prismaCode(error) !== "P2002") throw error;
    const proposal = await prisma.nodeEdgeProposal.findUnique({ where: { id: proposalId } });
    if (
      !proposal ||
      proposal.status !== "proposed" ||
      proposal.revision !== parsed.expectedRevision
    ) {
      throw error;
    }
    const existing = await prisma.nodeEdge.findUnique({
      where: {
        sourceNodeVersionId_targetNodeId_relationType: {
          sourceNodeVersionId: proposal.sourceNodeVersionId,
          targetNodeId: proposal.targetNodeId,
          relationType: proposal.relationType,
        },
      },
      include: { confirmedBy: { select: { role: true } } },
    });
    if (
      existing?.status !== "confirmed" ||
      existing.provenance !== "confirmed-by-editor" ||
      existing.confirmedTargetNodeVersionId !== proposal.targetNodeVersionId ||
      !existing.confirmedById ||
      !existing.confirmedAt ||
      !isEditorialRole(existing.confirmedBy?.role)
    ) {
      throw error;
    }
    return decide();
  }
}

function isEditorialRole(role: string | null | undefined): boolean {
  return role === "EDITOR" || role === "ADMIN";
}

export async function listPendingNodeEdgeProposals() {
  const rows = await prisma.nodeEdgeProposal.findMany({
    where: { status: "proposed" },
    include: {
      sourceNodeVersion: { include: { knowledgeNode: { include: { repository: true } } } },
      targetNodeVersion: { include: { knowledgeNode: { include: { repository: true } } } },
      agentRun: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    origin: row.origin,
    relationType: row.relationType,
    rationale: row.rationale ?? "No rationale supplied.",
    source: {
      id: row.sourceNodeVersion.knowledgeNode.id,
      localNodeId: row.sourceNodeVersion.knowledgeNode.localNodeId,
      title: row.sourceNodeVersion.title,
      repository: row.sourceNodeVersion.knowledgeNode.repository.canonicalUrl,
    },
    target: {
      id: row.targetNodeVersion.knowledgeNode.id,
      localNodeId: row.targetNodeVersion.knowledgeNode.localNodeId,
      title: row.targetNodeVersion.title,
      repository: row.targetNodeVersion.knowledgeNode.repository.canonicalUrl,
    },
    agentRunId: row.agentRun?.id,
  }));
}

/** Public authoritative projection. Rejected/superseded/proposed records never enter it. */
export async function listConfirmedEdgesForNode(nodeId: string) {
  const rows = await prisma.nodeEdge.findMany({
    where: {
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: { not: null },
      confirmedById: { not: null },
      confirmedAt: { not: null },
      confirmedBy: { is: { role: { in: ["EDITOR", "ADMIN"] } } },
      OR: [
        { sourceNodeVersion: { knowledgeNodeId: nodeId } },
        { relationType: "contradicts", targetNodeId: nodeId },
      ],
    },
    include: {
      sourceNodeVersion: { include: { knowledgeNode: true } },
      targetNode: true,
      confirmedTargetNodeVersion: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows
    .filter((row) => row.confirmedTargetNodeVersion?.knowledgeNodeId === row.targetNodeId)
    .map((row) => {
      const sourceIsSeed = row.sourceNodeVersion.knowledgeNodeId === nodeId;
      return {
        id: row.id,
        relationType: row.relationType,
        status: "confirmed" as const,
        symmetric: row.relationType === "contradicts",
        otherNode: sourceIsSeed
          ? {
              id: row.targetNode.id,
              localNodeId: row.targetNode.localNodeId,
              title: row.confirmedTargetNodeVersion!.title,
            }
          : {
              id: row.sourceNodeVersion.knowledgeNode.id,
              localNodeId: row.sourceNodeVersion.knowledgeNode.localNodeId,
              title: row.sourceNodeVersion.title,
            },
      };
    });
}

async function requireCurrentEditor(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role !== "EDITOR" && user.role !== "ADMIN")) {
    throw new NodeEdgeLifecycleError("Editor role required for edge decisions.", "forbidden");
  }
}

function decisionStatus(
  decision: NodeEdgeDecision["decision"],
): "confirmed" | "rejected" | "superseded" {
  return decision === "confirm" ? "confirmed" : decision === "reject" ? "rejected" : "superseded";
}

async function claimIdempotency(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.idempotencyKey.create({ data: { key } });
}

function assertSameProposal(
  existing: {
    sourceStableKey: string;
    targetStableKey: string;
    relationType: string;
    origin: string;
    evidenceJson: string;
    rationale?: string | null;
  },
  prepared: {
    sourceStableKey: string;
    targetStableKey: string;
    relationType: string;
    origin: string;
    evidenceJson: string;
    rationale?: string | null;
  },
): void {
  const comparable = (value: typeof existing) => ({
    sourceStableKey: value.sourceStableKey,
    targetStableKey: value.targetStableKey,
    relationType: value.relationType,
    origin: value.origin,
    evidenceJson: value.evidenceJson,
    rationale: value.rationale ?? null,
  });
  if (canonicalJson(comparable(existing)) !== canonicalJson(comparable(prepared))) {
    throw new NodeEdgeLifecycleError(
      "Proposal origin key collided with different content.",
      "conflict",
    );
  }
}

function stableNodeVersionKey(
  githubRepositoryId: string,
  localNodeId: string,
  commitSha: string,
): string {
  return canonicalJson({ githubRepositoryId, localNodeId, commitSha: commitSha.toLowerCase() });
}

function assertAgentRunCandidate(
  outputJson: string | null,
  input: {
    sourceStableKey: string;
    targetStableKey: string;
    relationType: string;
    rationale: string;
    evidence: unknown;
  },
): void {
  const candidate = {
    sourceStableKey: input.sourceStableKey,
    targetStableKey: input.targetStableKey,
    relationType: input.relationType,
    rationale: input.rationale,
    evidence: input.evidence,
  };
  const candidateJson = canonicalJson(candidate);
  const candidateHash = createHash("sha256").update(candidateJson).digest("hex");
  let recorded: unknown;
  try {
    recorded = outputJson ? JSON.parse(outputJson) : undefined;
  } catch {
    throw new NodeEdgeLifecycleError("AgentRun output is not valid JSON.", "conflict");
  }
  if (canonicalJson(recorded) !== canonicalJson({ candidate, candidateHash })) {
    throw new NodeEdgeLifecycleError(
      "The proposal does not match the candidate recorded by the AgentRun.",
      "conflict",
    );
  }
}
