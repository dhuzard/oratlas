import "server-only";
import {
  canonicalJson,
  nodeAliasSchema,
  nodeIdentityDecisionSchema,
  type NodeIdentityCandidate,
  type NodeIdentityDecision,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { proposeNodeIdentities } from "@oratlas/knowledge";
import { prisma } from "./db";
import { withSqliteRetry } from "./db-retry";

const MAX_CLAIM_CANDIDATES = 2_000;

export class NodeIdentityLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "NodeIdentityLifecycleError";
  }
}

/**
 * Compare newly published claims with the bounded current corpus and persist
 * deterministic suggestions. Stable nodes and relation-scoped TRUST records
 * are deliberately untouched.
 */
export async function materializeSameClaimProposals(
  tx: Prisma.TransactionClient,
  newlyPublishedNodeIds: readonly string[],
): Promise<string[]> {
  if (newlyPublishedNodeIds.length === 0) return [];
  const rows = await tx.knowledgeNode.findMany({
    where: { kind: "claim", versions: { some: {} } },
    include: {
      aliases: true,
      versions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
    orderBy: { id: "asc" },
    take: MAX_CLAIM_CANDIDATES + 1,
  });
  if (rows.length > MAX_CLAIM_CANDIDATES) {
    throw new NodeIdentityLifecycleError(
      `Claim identity scan exceeds the bounded ${MAX_CLAIM_CANDIDATES}-node corpus.`,
      "conflict",
    );
  }
  const candidates = rows.flatMap((row): NodeIdentityCandidate[] => {
    const version = row.versions[0];
    if (!version) return [];
    try {
      const payload = JSON.parse(version.payloadJson) as {
        statement?: unknown;
        qualifiers?: unknown;
      };
      if (typeof payload.statement !== "string" || !Array.isArray(payload.qualifiers)) return [];
      if (!payload.qualifiers.every((value) => typeof value === "string")) return [];
      return [
        {
          knowledgeNodeId: row.id,
          repositoryId: row.repositoryId,
          localNodeId: row.localNodeId,
          kind: "claim",
          aliases: row.aliases.flatMap((alias) => {
            const parsed = nodeAliasSchema.safeParse(alias);
            return parsed.success ? [parsed.data] : [];
          }),
          claim: { statement: payload.statement, qualifiers: payload.qualifiers as string[] },
        },
      ];
    } catch {
      return [];
    }
  });
  const newIds = new Set(newlyPublishedNodeIds);
  const proposals = proposeNodeIdentities(candidates).proposals.filter(
    (proposal) =>
      proposal.kind === "same-claim" &&
      (newIds.has(proposal.source.knowledgeNodeId) || newIds.has(proposal.target.knowledgeNodeId)),
  );
  for (const proposal of proposals) {
    await tx.nodeIdentityProposal.upsert({
      where: { id: proposal.proposalId },
      update: {},
      create: {
        id: proposal.proposalId,
        kind: proposal.kind,
        sourceNodeId: proposal.source.knowledgeNodeId,
        targetNodeId: proposal.target.knowledgeNodeId,
        signalsJson: canonicalJson(proposal.signals),
        sharedAliasesJson: canonicalJson(proposal.sharedAliases),
        sourceTextHash: proposal.sourceTextHash,
        targetTextHash: proposal.targetTextHash,
        textSimilarity: proposal.textSimilarity,
        methodVersion: proposal.methodVersion,
      },
    });
  }
  return proposals.map((proposal) => proposal.proposalId);
}

export async function decideNodeIdentityProposal(
  actor: { id: string; role: string },
  proposalId: string,
  input: NodeIdentityDecision,
): Promise<{ status: "confirmed" | "rejected"; revision: number; idempotent: boolean }> {
  const decision = nodeIdentityDecisionSchema.parse(input);
  await requireCurrentEditor(actor.id);
  const requested = decision.decision === "confirm" ? "confirmed" : "rejected";
  return withSqliteRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          const proposal = await tx.nodeIdentityProposal.findUnique({ where: { id: proposalId } });
          if (!proposal) {
            throw new NodeIdentityLifecycleError("Same-claim proposal not found.", "not-found");
          }
          if (proposal.status === requested) {
            if (
              proposal.reviewedById === actor.id &&
              proposal.reviewNote === decision.note &&
              proposal.revision === decision.expectedRevision + 1
            ) {
              return { status: requested, revision: proposal.revision, idempotent: true };
            }
            throw new NodeIdentityLifecycleError(
              "Proposal already received a different decision.",
              "conflict",
            );
          }
          if (proposal.status !== "proposed" || proposal.revision !== decision.expectedRevision) {
            throw new NodeIdentityLifecycleError("Proposal changed concurrently.", "conflict");
          }
          const changed = await tx.nodeIdentityProposal.updateMany({
            where: { id: proposal.id, status: "proposed", revision: decision.expectedRevision },
            data: {
              status: requested,
              revision: { increment: 1 },
              reviewedById: actor.id,
              reviewedAt: new Date(),
              reviewNote: decision.note,
            },
          });
          if (changed.count !== 1) {
            throw new NodeIdentityLifecycleError("Proposal changed concurrently.", "conflict");
          }
          const revision = decision.expectedRevision + 1;
          const key = `node-identity.${requested}:${proposal.id}:${revision}`;
          await tx.idempotencyKey.create({ data: { key } });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: `node-identity.${requested}`,
              subjectType: "node-identity-proposal",
              subjectId: proposal.id,
              idempotencyKey: key,
              detailsJson: canonicalJson({
                sourceNodeId: proposal.sourceNodeId,
                targetNodeId: proposal.targetNodeId,
                revision,
                note: decision.note,
              }),
            },
          });
          return { status: requested, revision, idempotent: false };
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      ),
    (error) => error instanceof NodeIdentityLifecycleError,
  );
}

export async function listPendingNodeIdentityProposals() {
  const rows = await prisma.nodeIdentityProposal.findMany({
    where: { kind: "same-claim", status: "proposed" },
    include: {
      sourceNode: {
        include: {
          repository: true,
          versions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
        },
      },
      targetNode: {
        include: {
          repository: true,
          versions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.flatMap((row) => {
    const sourceVersion = row.sourceNode.versions[0];
    const targetVersion = row.targetNode.versions[0];
    if (!sourceVersion || !targetVersion) return [];
    return [
      {
        id: row.id,
        revision: row.revision,
        signals: parseStringArray(row.signalsJson),
        textSimilarity: row.textSimilarity ?? undefined,
        methodVersion: row.methodVersion,
        source: {
          nodeId: row.sourceNode.id,
          localNodeId: row.sourceNode.localNodeId,
          title: sourceVersion.title,
          repository: row.sourceNode.repository.canonicalUrl,
        },
        target: {
          nodeId: row.targetNode.id,
          localNodeId: row.targetNode.localNodeId,
          title: targetVersion.title,
          repository: row.targetNode.repository.canonicalUrl,
        },
      },
    ];
  });
}

async function requireCurrentEditor(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role !== "EDITOR" && user.role !== "ADMIN")) {
    throw new NodeIdentityLifecycleError(
      "Editor role required for same-claim decisions.",
      "forbidden",
    );
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}
