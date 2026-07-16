import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@oratlas/db";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  synthesisRegenerationProposalSchema,
  synthesisRegenerationProposalDecisionSchema,
  synthesisSelectorSchema,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_STALENESS_POLICY_VERSION,
  SYNTHESIS_STALENESS_REASON_CODES,
  type SynthesisRegenerationProposalDecision,
  type SynthesisStalenessReasonCode,
} from "@oratlas/contracts";
import type { SubgraphEvidencePacket } from "@oratlas/contracts";
import type { SessionUser } from "./auth";
import { prisma } from "./db";
import { getPublicSynthesisReview, loadPreparedSynthesisPacket } from "./synthesis-editorial";

const SCAN_LIMIT = 100;
const AFFECTED_REFERENCE_LIMIT = 100;
const SERIALIZABLE_ATTEMPTS = 3;

type AffectedReference = {
  kind: "node" | "edge" | "trust" | "policy";
  id: string;
  change: "added" | "removed" | "changed";
};

export class SynthesisStalenessError extends Error {
  constructor(
    message: string,
    readonly code: "bad-request" | "not-found" | "conflict" | "forbidden" = "bad-request",
  ) {
    super(message);
    this.name = "SynthesisStalenessError";
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertEditor(actor: SessionUser): void {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new SynthesisStalenessError("Editor role required.", "forbidden");
  }
}

function withoutTrust(edge: SubgraphEvidencePacket["edges"][number]) {
  const { trust: _trust, ...identity } = edge;
  return identity;
}

export function compareSynthesisPackets(
  accepted: SubgraphEvidencePacket,
  evaluated: SubgraphEvidencePacket,
) {
  const reasons = new Set<SynthesisStalenessReasonCode>();
  const affected: AffectedReference[] = [];
  const oldNodes = new Map(accepted.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(evaluated.nodes.map((node) => [node.id, node]));
  for (const [id, node] of oldNodes) {
    const current = newNodes.get(id);
    if (!current) {
      reasons.add("membership-removed");
      affected.push({ kind: "node", id, change: "removed" });
    } else if (node.versionId !== current.versionId) {
      reasons.add("node-head-changed");
      affected.push({ kind: "node", id, change: "changed" });
    }
  }
  for (const id of newNodes.keys()) {
    if (!oldNodes.has(id)) {
      reasons.add("membership-added");
      affected.push({ kind: "node", id, change: "added" });
    }
  }

  const oldEdges = new Map(accepted.edges.map((edge) => [edge.id, edge]));
  const newEdges = new Map(evaluated.edges.map((edge) => [edge.id, edge]));
  for (const [id, edge] of oldEdges) {
    const current = newEdges.get(id);
    if (!current) {
      reasons.add("confirmed-edge-removed");
      affected.push({ kind: "edge", id, change: "removed" });
      continue;
    }
    if (canonicalJson(withoutTrust(edge)) !== canonicalJson(withoutTrust(current))) {
      reasons.add("confirmed-edge-changed");
      affected.push({ kind: "edge", id, change: "changed" });
    }
    if (canonicalJson(edge.trust ?? null) !== canonicalJson(current.trust ?? null)) {
      reasons.add("trust-changed");
      affected.push({ kind: "trust", id, change: "changed" });
    }
  }
  for (const id of newEdges.keys()) {
    if (!oldEdges.has(id)) {
      reasons.add("confirmed-edge-added");
      affected.push({ kind: "edge", id, change: "added" });
    }
  }
  return { reasons, affected };
}

async function runSerializable<T>(client: PrismaClient, operation: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        (error.code !== "P2034" && error.code !== "P2002") ||
        attempt === SERIALIZABLE_ATTEMPTS - 1
      )
        throw error;
    }
  }
  throw last;
}

async function loadAcceptedHead(reviewId: string, client: PrismaClient) {
  const review = await client.review.findUnique({
    where: { id: reviewId },
    include: { currentSynthesisVersion: { include: { synthesisDraft: true } } },
  });
  if (!review || review.reviewType !== "ai-synthesis" || !review.currentSynthesisVersion) {
    throw new SynthesisStalenessError("Accepted synthesis head not found.", "not-found");
  }
  const publicReview = await getPublicSynthesisReview(review.slug, client);
  if (!publicReview) {
    throw new SynthesisStalenessError("Accepted synthesis provenance is invalid.", "conflict");
  }
  const version = review.currentSynthesisVersion;
  const draft = version.synthesisDraft;
  if (!draft) throw new SynthesisStalenessError("Accepted synthesis draft is missing.", "conflict");
  const selector = synthesisSelectorSchema.parse(JSON.parse(draft.selectorJson) as unknown);
  const acceptedPacket = subgraphEvidencePacketSchema.parse(
    JSON.parse(draft.packetJson) as unknown,
  );
  if (
    canonicalJson(selector) !== draft.selectorJson ||
    digest(draft.selectorJson) !== draft.selectorHash ||
    canonicalJson(acceptedPacket) !== draft.packetJson ||
    digest(draft.packetJson) !== draft.packetHash
  ) {
    throw new SynthesisStalenessError("Accepted synthesis snapshot is not canonical.", "conflict");
  }
  return { review, version, draft, selector, acceptedPacket };
}

export async function evaluateSynthesisHead(
  reviewId: string,
  options: { client?: PrismaClient; now?: () => Date; materializationPolicyVersion?: string } = {},
) {
  const client = options.client ?? prisma;
  const head = await loadAcceptedHead(reviewId, client);
  const reasons = new Set<SynthesisStalenessReasonCode>();
  const affected: AffectedReference[] = [];
  const evaluatedMaterializationPolicyVersion =
    options.materializationPolicyVersion ?? SYNTHESIS_MATERIALIZATION_POLICY_VERSION;
  if (
    evaluatedMaterializationPolicyVersion.length < 1 ||
    evaluatedMaterializationPolicyVersion.length > 120
  ) {
    throw new SynthesisStalenessError("Materialization policy version is invalid.");
  }
  if (head.draft.materializationPolicyVersion !== evaluatedMaterializationPolicyVersion) {
    reasons.add("materialization-policy-changed");
    affected.push({
      kind: "policy",
      id: evaluatedMaterializationPolicyVersion.slice(0, 200),
      change: "changed",
    });
  }

  let evaluatedPacket: SubgraphEvidencePacket | null = null;
  let evaluatedPacketJson: string | null = null;
  let evaluatedPacketHash: string | null = null;
  try {
    const prepared = await loadPreparedSynthesisPacket(head.selector, client);
    evaluatedPacket = prepared.packet;
    evaluatedPacketJson = prepared.json;
    evaluatedPacketHash = prepared.sha256;
    const delta = compareSynthesisPackets(head.acceptedPacket, evaluatedPacket);
    for (const reason of delta.reasons) reasons.add(reason);
    affected.push(...delta.affected);
    if (head.draft.packetHash !== evaluatedPacketHash && delta.reasons.size === 0) {
      reasons.add("packet-content-changed");
      affected.push({ kind: "policy", id: "packet-content", change: "changed" });
    }
  } catch {
    reasons.add("materialization-failed");
    affected.push({ kind: "policy", id: "materialization", change: "changed" });
  }

  const orderedReasons = SYNTHESIS_STALENESS_REASON_CODES.filter((reason) => reasons.has(reason));
  const orderedAffected = [...affected].sort((left, right) =>
    compare(
      `${left.kind}\0${left.id}\0${left.change}`,
      `${right.kind}\0${right.id}\0${right.change}`,
    ),
  );
  const uniqueAffected = orderedAffected.filter(
    (entry, index) =>
      index === 0 || canonicalJson(entry) !== canonicalJson(orderedAffected[index - 1]),
  );
  const storedAffected = uniqueAffected.slice(0, AFFECTED_REFERENCE_LIMIT);
  const status = orderedReasons.length === 0 ? "fresh" : "stale";
  const evaluationIdentity = {
    policyVersion: SYNTHESIS_STALENESS_POLICY_VERSION,
    acceptedReviewVersionId: head.version.id,
    seriesKey: head.draft.seriesKey,
    selectorHash: head.draft.selectorHash,
    acceptedMaterializationPolicyVersion: head.draft.materializationPolicyVersion,
    evaluatedMaterializationPolicyVersion,
    acceptedPacketHash: head.draft.packetHash,
    evaluatedPacketHash,
    status,
    reasonCodes: orderedReasons,
    affectedReferences: storedAffected,
    affectedReferenceCount: uniqueAffected.length,
    affectedReferencesTruncated: uniqueAffected.length > storedAffected.length,
  };
  const evaluationKey = digest(canonicalJson(evaluationIdentity));
  const evaluatedAt = options.now?.() ?? new Date();

  return runSerializable(client, () =>
    client.$transaction(
      async (tx) => {
        const currentHead = await tx.review.findUnique({
          where: { id: head.review.id },
          select: { currentSynthesisVersionId: true },
        });
        if (currentHead?.currentSynthesisVersionId !== head.version.id) {
          throw new SynthesisStalenessError(
            "Synthesis head changed during freshness evaluation.",
            "conflict",
          );
        }
        let evaluation = await tx.synthesisStalenessEvaluation.findUnique({
          where: { evaluationKey },
        });
        if (!evaluation) {
          evaluation = await tx.synthesisStalenessEvaluation.create({
            data: {
              evaluationKey,
              policyVersion: SYNTHESIS_STALENESS_POLICY_VERSION,
              reviewId: head.review.id,
              acceptedReviewVersionId: head.version.id,
              acceptedDraftId: head.draft.id,
              seriesKey: head.draft.seriesKey,
              selectorJson: head.draft.selectorJson,
              selectorHash: head.draft.selectorHash,
              acceptedMaterializationPolicyVersion: head.draft.materializationPolicyVersion,
              evaluatedMaterializationPolicyVersion,
              acceptedPacketHash: head.draft.packetHash,
              acceptedPacketJson: head.draft.packetJson,
              evaluatedPacketHash,
              evaluatedPacketJson,
              status,
              reasonCodesJson: canonicalJson(orderedReasons),
              affectedReferencesJson: canonicalJson(storedAffected),
              affectedReferenceCount: uniqueAffected.length,
              affectedReferencesTruncated: uniqueAffected.length > storedAffected.length,
              evaluatedAt,
            },
          });
          await tx.auditEvent.create({
            data: {
              action: "synthesis.staleness-evaluated",
              subjectType: "synthesisStalenessEvaluation",
              subjectId: evaluation.id,
              idempotencyKey: `synthesis-staleness:evaluation:${evaluationKey}`,
              detailsJson: canonicalJson({
                reviewId: head.review.id,
                acceptedReviewVersionId: head.version.id,
                evaluationKey,
                policyVersion: SYNTHESIS_STALENESS_POLICY_VERSION,
                status,
                reasonCodes: orderedReasons,
                affectedReferenceCount: uniqueAffected.length,
                affectedReferencesTruncated: uniqueAffected.length > storedAffected.length,
              }),
            },
          });
        }

        const obsoleteHeadProposals = await tx.synthesisRegenerationProposal.findMany({
          where: {
            reviewId: head.review.id,
            status: "open",
            acceptedReviewVersionId: { not: head.version.id },
          },
          select: { id: true, acceptedReviewVersionId: true },
        });
        await tx.synthesisRegenerationProposal.updateMany({
          where: {
            reviewId: head.review.id,
            status: "open",
            acceptedReviewVersionId: { not: head.version.id },
          },
          data: { status: "superseded", openHeadKey: null },
        });
        if (obsoleteHeadProposals.length > 0) {
          await tx.auditEvent.createMany({
            data: obsoleteHeadProposals.map((proposal) => ({
              action: "synthesis.regeneration-proposal.superseded",
              subjectType: "synthesisRegenerationProposal",
              subjectId: proposal.id,
              idempotencyKey: `synthesis-staleness:proposal:${proposal.id}:superseded:head:${head.version.id}`,
              detailsJson: canonicalJson({
                cause: "accepted-head-changed",
                reviewId: head.review.id,
                previousAcceptedReviewVersionId: proposal.acceptedReviewVersionId,
                currentAcceptedReviewVersionId: head.version.id,
              }),
            })),
          });
        }
        const open = await tx.synthesisRegenerationProposal.findUnique({
          where: { openHeadKey: head.version.id },
        });
        const proposalForEvaluation = await tx.synthesisRegenerationProposal.findUnique({
          where: { evaluationId: evaluation.id },
        });
        if (status === "fresh") {
          if (open) {
            await tx.synthesisRegenerationProposal.update({
              where: { id: open.id },
              data: { status: "superseded", openHeadKey: null },
            });
            await tx.auditEvent.create({
              data: {
                action: "synthesis.regeneration-proposal.superseded",
                subjectType: "synthesisRegenerationProposal",
                subjectId: open.id,
                idempotencyKey: `synthesis-staleness:proposal:${open.id}:superseded:fresh:${evaluationKey}`,
                detailsJson: canonicalJson({
                  cause: "evaluated-fresh",
                  reviewId: head.review.id,
                  acceptedReviewVersionId: head.version.id,
                  evaluationKey,
                }),
              },
            });
          }
        } else if (!open && !proposalForEvaluation) {
          const proposal = await tx.synthesisRegenerationProposal.create({
            data: {
              evaluationId: evaluation.id,
              reviewId: head.review.id,
              acceptedReviewVersionId: head.version.id,
              openHeadKey: head.version.id,
            },
          });
          await tx.auditEvent.create({
            data: {
              action: "synthesis.regeneration-proposal.created",
              subjectType: "synthesisRegenerationProposal",
              subjectId: proposal.id,
              idempotencyKey: `synthesis-staleness:proposal:${evaluation.id}:created`,
              detailsJson: canonicalJson({
                reviewId: head.review.id,
                acceptedReviewVersionId: head.version.id,
                evaluationKey,
                reasonCodes: orderedReasons,
              }),
            },
          });
        } else if (open && open.evaluationId !== evaluation.id) {
          await tx.synthesisRegenerationProposal.update({
            where: { id: open.id },
            data: { status: "superseded", openHeadKey: null },
          });
          await tx.auditEvent.create({
            data: {
              action: "synthesis.regeneration-proposal.superseded",
              subjectType: "synthesisRegenerationProposal",
              subjectId: open.id,
              idempotencyKey: `synthesis-staleness:proposal:${open.id}:superseded:evaluation:${evaluationKey}`,
              detailsJson: canonicalJson({
                cause: "newer-evaluation",
                reviewId: head.review.id,
                acceptedReviewVersionId: head.version.id,
                replacementEvaluationKey: evaluationKey,
              }),
            },
          });
          if (!proposalForEvaluation) {
            const proposal = await tx.synthesisRegenerationProposal.create({
              data: {
                evaluationId: evaluation.id,
                reviewId: head.review.id,
                acceptedReviewVersionId: head.version.id,
                openHeadKey: head.version.id,
              },
            });
            await tx.auditEvent.create({
              data: {
                action: "synthesis.regeneration-proposal.created",
                subjectType: "synthesisRegenerationProposal",
                subjectId: proposal.id,
                idempotencyKey: `synthesis-staleness:proposal:${evaluation.id}:created`,
                detailsJson: canonicalJson({
                  reviewId: head.review.id,
                  acceptedReviewVersionId: head.version.id,
                  evaluationKey,
                  reasonCodes: orderedReasons,
                }),
              },
            });
          }
        }
        return {
          evaluationKey,
          reviewSlug: head.review.slug,
          acceptedReviewVersionId: head.version.id,
          status,
          reasonCodes: orderedReasons,
          affectedReferences: storedAffected,
          affectedReferenceCount: uniqueAffected.length,
          affectedReferencesTruncated: uniqueAffected.length > storedAffected.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function scanAcceptedSyntheses(
  options: {
    client?: PrismaClient;
    actor?: SessionUser;
    now?: () => Date;
    materializationPolicyVersion?: string;
  } = {},
) {
  const client = options.client ?? prisma;
  if (options.actor) {
    assertEditor(options.actor);
    const currentActor = await client.user.findUnique({ where: { id: options.actor.id } });
    if (!currentActor || (currentActor.role !== "EDITOR" && currentActor.role !== "ADMIN")) {
      throw new SynthesisStalenessError("Editor role required.", "forbidden");
    }
  }
  const reviews = await client.review.findMany({
    where: {
      reviewType: "ai-synthesis",
      status: "published",
      currentSynthesisVersionId: { not: null },
    },
    orderBy: { id: "asc" },
    take: SCAN_LIMIT + 1,
    select: { id: true },
  });
  if (reviews.length > SCAN_LIMIT) {
    throw new SynthesisStalenessError("Synthesis scan exceeds the configured bound.", "conflict");
  }
  const results = [];
  for (const review of reviews) {
    results.push(await evaluateSynthesisHead(review.id, options));
  }
  return { scanned: results.length, results };
}

export async function listSynthesisRegenerationProposals(client: PrismaClient = prisma) {
  const rows = await client.synthesisRegenerationProposal.findMany({
    where: { status: "open" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: SCAN_LIMIT,
    include: {
      evaluation: true,
      review: {
        select: {
          slug: true,
          title: true,
          currentSynthesisVersionId: true,
          synthesisStalenessEvaluations: {
            orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  return rows.flatMap((row) => {
    if (
      row.openHeadKey !== row.acceptedReviewVersionId ||
      row.review.currentSynthesisVersionId !== row.acceptedReviewVersionId ||
      row.evaluation.reviewId !== row.reviewId ||
      row.evaluation.acceptedReviewVersionId !== row.acceptedReviewVersionId ||
      row.evaluation.status !== "stale" ||
      row.review.synthesisStalenessEvaluations[0]?.id !== row.evaluation.id
    ) {
      return [];
    }
    try {
      const parsed = synthesisRegenerationProposalSchema.safeParse({
        id: row.id,
        revision: row.revision,
        status: row.status,
        reviewSlug: row.review.slug,
        reviewTitle: row.review.title,
        acceptedReviewVersionId: row.acceptedReviewVersionId,
        evaluationKey: row.evaluation.evaluationKey,
        reasonCodes: JSON.parse(row.evaluation.reasonCodesJson) as unknown,
        affectedReferences: JSON.parse(row.evaluation.affectedReferencesJson) as unknown,
        affectedReferenceCount: row.evaluation.affectedReferenceCount,
        affectedReferencesTruncated: row.evaluation.affectedReferencesTruncated,
        createdAt: row.createdAt.toISOString(),
      });
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export async function decideSynthesisRegenerationProposal(
  actor: SessionUser,
  proposalId: string,
  inputValue: SynthesisRegenerationProposalDecision,
  client: PrismaClient = prisma,
) {
  assertEditor(actor);
  const input = synthesisRegenerationProposalDecisionSchema.parse(inputValue);
  const inputHash = digest(canonicalJson(input));
  return runSerializable(client, () =>
    client.$transaction(
      async (tx) => {
        const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
        if (!currentActor || (currentActor.role !== "EDITOR" && currentActor.role !== "ADMIN")) {
          throw new SynthesisStalenessError("Editor role required.", "forbidden");
        }
        const proposal = await tx.synthesisRegenerationProposal.findUnique({
          where: { id: proposalId },
          include: {
            review: { select: { currentSynthesisVersionId: true } },
            evaluation: { select: { id: true, status: true } },
          },
        });
        if (!proposal) throw new SynthesisStalenessError("Proposal not found.", "not-found");
        if (proposal.status !== "open") {
          if (
            proposal.resolutionIdempotencyKey === input.idempotencyKey &&
            proposal.resolutionInputHash === inputHash
          )
            return { status: proposal.status, revision: proposal.revision };
          throw new SynthesisStalenessError("Proposal is no longer open.", "conflict");
        }
        if (proposal.review.currentSynthesisVersionId !== proposal.acceptedReviewVersionId) {
          throw new SynthesisStalenessError(
            "Proposal targets an obsolete synthesis head.",
            "conflict",
          );
        }
        const latestEvaluation = await tx.synthesisStalenessEvaluation.findFirst({
          where: { acceptedReviewVersionId: proposal.acceptedReviewVersionId },
          orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (
          proposal.evaluation.status !== "stale" ||
          latestEvaluation?.id !== proposal.evaluation.id
        ) {
          throw new SynthesisStalenessError(
            "Proposal evaluation is no longer current.",
            "conflict",
          );
        }
        const status = input.action === "dismiss" ? "dismissed" : "regeneration-requested";
        const changed = await tx.synthesisRegenerationProposal.updateMany({
          where: { id: proposal.id, status: "open", revision: input.expectedRevision },
          data: {
            status,
            revision: { increment: 1 },
            openHeadKey: null,
            resolvedById: currentActor.id,
            resolvedAt: new Date(),
            resolutionRationale: input.rationale,
            resolutionIdempotencyKey: input.idempotencyKey,
            resolutionInputHash: inputHash,
          },
        });
        if (changed.count !== 1) {
          throw new SynthesisStalenessError("Proposal revision changed concurrently.", "conflict");
        }
        await tx.auditEvent.create({
          data: {
            actorId: currentActor.id,
            action: `synthesis.regeneration-proposal.${status}`,
            subjectType: "synthesisRegenerationProposal",
            subjectId: proposal.id,
            idempotencyKey: input.idempotencyKey,
            detailsJson: canonicalJson({
              acceptedReviewVersionId: proposal.acceptedReviewVersionId,
            }),
          },
        });
        return { status, revision: proposal.revision + 1 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
