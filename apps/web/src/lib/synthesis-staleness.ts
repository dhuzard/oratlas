import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@oratlas/db";
import { ZodError } from "zod";
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
  type SynthesisStalenessAffectedReference,
  type SynthesisStalenessReasonCode,
} from "@oratlas/contracts";
import type { SubgraphEvidencePacket } from "@oratlas/contracts";
import type { SessionUser } from "./auth";
import { prisma } from "./db";
import {
  getPublicSynthesisReview,
  loadPreparedSynthesisPacket,
  SynthesisEditorialError,
} from "./synthesis-editorial";
import { validateStoredSynthesisStaleness } from "./synthesis-staleness-integrity";

const SCAN_LIMIT = 100;
const AFFECTED_REFERENCE_LIMIT = 100;
const SERIALIZABLE_ATTEMPTS = 3;

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

function classifyMaterializationFailure(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return "database-read-failed" as const;
  if (error instanceof ZodError) return "invalid-materialization" as const;
  if (error instanceof SynthesisEditorialError) {
    if (error.code === "not-found") return "selection-unavailable" as const;
    if (error.code === "conflict") return "materialization-conflict" as const;
    return "bounded-selection-invalid" as const;
  }
  return "unexpected-materialization-failure" as const;
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
  const affected: SynthesisStalenessAffectedReference[] = [];
  const oldNodes = new Map(accepted.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(evaluated.nodes.map((node) => [node.id, node]));
  for (const [id, node] of oldNodes) {
    const current = newNodes.get(id);
    if (!current) {
      reasons.add("membership-removed");
      affected.push({ kind: "node", id, change: "removed", previousVersionId: node.versionId });
    } else if (node.versionId !== current.versionId) {
      reasons.add("node-head-changed");
      affected.push({
        kind: "node",
        id,
        change: "changed",
        previousVersionId: node.versionId,
        currentVersionId: current.versionId,
      });
    }
  }
  for (const id of newNodes.keys()) {
    if (!oldNodes.has(id)) {
      reasons.add("membership-added");
      affected.push({
        kind: "node",
        id,
        change: "added",
        currentVersionId: newNodes.get(id)!.versionId,
      });
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
  options: {
    client?: PrismaClient;
    now?: () => Date;
    materializationPolicyVersion?: string;
    actor?: SessionUser;
    loadPacket?: typeof loadPreparedSynthesisPacket;
  } = {},
) {
  const client = options.client ?? prisma;
  const head = await loadAcceptedHead(reviewId, client);
  const reasons = new Set<SynthesisStalenessReasonCode>();
  const affected: SynthesisStalenessAffectedReference[] = [];
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
  let failureCode: ReturnType<typeof classifyMaterializationFailure> | null = null;
  let failureFingerprint: string | null = null;
  let materializationWatermark = "unavailable";
  try {
    const [nodeVersions, edges, trust] = await Promise.all([
      client.knowledgeNodeVersion.aggregate({
        _count: { id: true },
        _max: { id: true, createdAt: true },
      }),
      client.nodeEdge.aggregate({
        _count: { id: true },
        _max: { id: true, updatedAt: true },
      }),
      client.nodeRelationTrustAssessment.aggregate({
        _count: { id: true },
        _max: { id: true, updatedAt: true },
      }),
    ]);
    materializationWatermark = digest(
      canonicalJson({
        nodeVersions: {
          count: nodeVersions._count.id,
          maxId: nodeVersions._max.id,
          maxCreatedAt: nodeVersions._max.createdAt?.toISOString() ?? null,
        },
        edges: {
          count: edges._count.id,
          maxId: edges._max.id,
          maxUpdatedAt: edges._max.updatedAt?.toISOString() ?? null,
        },
        trust: {
          count: trust._count.id,
          maxId: trust._max.id,
          maxUpdatedAt: trust._max.updatedAt?.toISOString() ?? null,
        },
      }),
    );
    const loader = options.loadPacket ?? loadPreparedSynthesisPacket;
    const prepared = await loader(head.selector, client);
    const repeated = await loader(head.selector, client);
    if (prepared.sha256 !== repeated.sha256 || prepared.json !== repeated.json) {
      throw new SynthesisEditorialError(
        "Materialization changed during the freshness observation.",
        "conflict",
      );
    }
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
  } catch (error) {
    failureCode = classifyMaterializationFailure(error);
    failureFingerprint = digest(
      canonicalJson({
        failureCode,
        materializationWatermark,
        selectorHash: head.draft.selectorHash,
        acceptedPacketHash: head.draft.packetHash,
        evaluatedMaterializationPolicyVersion,
      }),
    );
    reasons.add("materialization-failed");
    affected.push({
      kind: "policy",
      id: `materialization:${failureCode}`,
      change: "changed",
    });
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
    failureCode,
    failureFingerprint,
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
              failureCode,
              failureFingerprint,
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
              actorId: options.actor?.id,
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

        const previousObservation = await tx.synthesisStalenessHead.findUnique({
          where: { acceptedReviewVersionId: head.version.id },
        });
        let observationChanged = false;
        let observationRevision = previousObservation?.revision ?? 0;
        if (!previousObservation) {
          await tx.synthesisStalenessHead.create({
            data: {
              acceptedReviewVersionId: head.version.id,
              reviewId: head.review.id,
              currentEvaluationId: evaluation.id,
              observedAt: evaluatedAt,
            },
          });
          observationChanged = true;
        } else if (previousObservation.currentEvaluationId !== evaluation.id) {
          const changed = await tx.synthesisStalenessHead.updateMany({
            where: {
              acceptedReviewVersionId: head.version.id,
              currentEvaluationId: previousObservation.currentEvaluationId,
              revision: previousObservation.revision,
            },
            data: {
              currentEvaluationId: evaluation.id,
              revision: { increment: 1 },
              observedAt: evaluatedAt,
            },
          });
          if (changed.count !== 1) {
            throw new SynthesisStalenessError(
              "Synthesis freshness observation changed concurrently.",
              "conflict",
            );
          }
          observationRevision = previousObservation.revision + 1;
          observationChanged = true;
        }
        if (observationChanged) {
          await tx.auditEvent.create({
            data: {
              actorId: options.actor?.id,
              action: "synthesis.staleness-observed",
              subjectType: "reviewVersion",
              subjectId: head.version.id,
              idempotencyKey: `synthesis-staleness:head:${head.version.id}:observation:${observationRevision}`,
              detailsJson: canonicalJson({
                reviewId: head.review.id,
                acceptedReviewVersionId: head.version.id,
                observationRevision,
                previousEvaluationKey: previousObservation
                  ? (
                      await tx.synthesisStalenessEvaluation.findUniqueOrThrow({
                        where: { id: previousObservation.currentEvaluationId },
                        select: { evaluationKey: true },
                      })
                    ).evaluationKey
                  : null,
                currentEvaluationKey: evaluationKey,
                status,
                reasonCodes: orderedReasons,
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
              actorId: options.actor?.id,
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
        if (observationChanged) {
          if (open) {
            await tx.synthesisRegenerationProposal.update({
              where: { id: open.id },
              data: { status: "superseded", openHeadKey: null },
            });
            await tx.auditEvent.create({
              data: {
                actorId: options.actor?.id,
                action: "synthesis.regeneration-proposal.superseded",
                subjectType: "synthesisRegenerationProposal",
                subjectId: open.id,
                idempotencyKey: `synthesis-staleness:proposal:${open.id}:superseded:observation:${observationRevision}`,
                detailsJson: canonicalJson({
                  cause: status === "fresh" ? "evaluated-fresh" : "changed-stale-observation",
                  reviewId: head.review.id,
                  acceptedReviewVersionId: head.version.id,
                  evaluationKey,
                  observationRevision,
                }),
              },
            });
          }
          if (status === "stale") {
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
                actorId: options.actor?.id,
                action: "synthesis.regeneration-proposal.created",
                subjectType: "synthesisRegenerationProposal",
                subjectId: proposal.id,
                idempotencyKey: `synthesis-staleness:head:${head.version.id}:observation:${observationRevision}:proposal`,
                detailsJson: canonicalJson({
                  reviewId: head.review.id,
                  acceptedReviewVersionId: head.version.id,
                  evaluationKey,
                  observationRevision,
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
    cursor?: string;
    limit?: number;
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
  const limit = options.limit ?? SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SCAN_LIMIT) {
    throw new SynthesisStalenessError("Synthesis scan limit is invalid.");
  }
  const reviews = await client.review.findMany({
    where: {
      reviewType: "ai-synthesis",
      status: "published",
      currentSynthesisVersionId: { not: null },
      ...(options.cursor ? { id: { gt: options.cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    select: { id: true, slug: true, currentSynthesisVersionId: true },
  });
  const page = reviews.slice(0, limit);
  const results = [];
  const failures: Array<{ code: "evaluation-failed"; reviewSlug?: string }> = [];
  for (const review of page) {
    try {
      results.push(await evaluateSynthesisHead(review.id, options));
    } catch {
      const safeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(review.slug)
        ? review.slug.slice(0, 200)
        : undefined;
      failures.push({ code: "evaluation-failed", ...(safeSlug ? { reviewSlug: safeSlug } : {}) });
      const key = `synthesis-staleness:scan-failure:${review.id}:${review.currentSynthesisVersionId ?? "missing"}`;
      try {
        await client.$transaction(async (tx) => {
          await tx.idempotencyKey.create({ data: { key, requestHash: digest(key) } });
          await tx.auditEvent.create({
            data: {
              actorId: options.actor?.id,
              action: "synthesis.staleness-scan-failed",
              subjectType: "review",
              subjectId: review.id,
              idempotencyKey: key,
              detailsJson: canonicalJson({
                code: "evaluation-failed",
                ...(safeSlug ? { reviewSlug: safeSlug } : {}),
              }),
            },
          });
        });
      } catch {
        // A duplicate claim or unavailable audit write must not block later heads in the batch.
      }
    }
  }
  return {
    scanned: page.length,
    succeeded: results.length,
    failed: failures.length,
    results,
    failures,
    nextCursor: reviews.length > limit ? page.at(-1)?.id : undefined,
  };
}

export async function listSynthesisRegenerationProposalPage(
  client: PrismaClient = prisma,
  options: { cursor?: string; limit?: number } = {},
) {
  const limit = options.limit ?? SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SCAN_LIMIT) {
    throw new SynthesisStalenessError("Proposal page limit is invalid.");
  }
  const rows = await client.synthesisRegenerationProposal.findMany({
    where: { status: "open", ...(options.cursor ? { id: { gt: options.cursor } } : {}) },
    orderBy: { id: "asc" },
    take: limit + 1,
    include: {
      evaluation: true,
      review: {
        select: {
          slug: true,
          title: true,
          currentSynthesisVersionId: true,
        },
      },
      acceptedReviewVersion: {
        select: {
          reviewId: true,
          synthesisDraftId: true,
          synthesisMaterializationPolicyVersion: true,
          synthesisStalenessHead: true,
          synthesisDraft: {
            select: {
              id: true,
              seriesKey: true,
              selectorJson: true,
              selectorHash: true,
              materializationPolicyVersion: true,
              packetJson: true,
              packetHash: true,
            },
          },
        },
      },
    },
  });
  const proposals = [];
  for (const row of rows.slice(0, limit)) {
    const version = row.acceptedReviewVersion;
    const draft = version.synthesisDraft;
    const observation = version.synthesisStalenessHead;
    if (
      row.openHeadKey !== row.acceptedReviewVersionId ||
      row.review.currentSynthesisVersionId !== row.acceptedReviewVersionId ||
      version.reviewId !== row.reviewId ||
      !draft ||
      !observation ||
      version.synthesisDraftId !== draft.id ||
      version.synthesisMaterializationPolicyVersion !== draft.materializationPolicyVersion ||
      observation.reviewId !== row.reviewId ||
      observation.acceptedReviewVersionId !== row.acceptedReviewVersionId ||
      observation.currentEvaluationId !== row.evaluation.id
    ) {
      continue;
    }
    const validated = validateStoredSynthesisStaleness(
      row.evaluation,
      {
        reviewId: row.reviewId,
        acceptedReviewVersionId: row.acceptedReviewVersionId,
        acceptedDraftId: draft.id,
        seriesKey: draft.seriesKey,
        selectorJson: draft.selectorJson,
        selectorHash: draft.selectorHash,
        materializationPolicyVersion: draft.materializationPolicyVersion,
        packetJson: draft.packetJson,
        packetHash: draft.packetHash,
      },
      observation.observedAt,
    );
    if (!validated || validated.freshness.status !== "stale") continue;
    if (!(await getPublicSynthesisReview(row.review.slug, client))) continue;
    try {
      const parsed = synthesisRegenerationProposalSchema.safeParse({
        id: row.id,
        revision: row.revision,
        status: row.status,
        reviewSlug: row.review.slug,
        reviewTitle: row.review.title,
        acceptedReviewVersionId: row.acceptedReviewVersionId,
        evaluationKey: row.evaluation.evaluationKey,
        reasonCodes: validated.reasonCodes,
        affectedReferences: validated.affectedReferences,
        affectedReferenceCount: row.evaluation.affectedReferenceCount,
        affectedReferencesTruncated: row.evaluation.affectedReferencesTruncated,
        createdAt: row.createdAt.toISOString(),
      });
      if (parsed.success) proposals.push(parsed.data);
    } catch {
      // Malformed private rows are omitted without breaking the remaining queue.
    }
  }
  return {
    proposals,
    nextCursor: rows.length > limit ? rows[limit - 1]?.id : undefined,
  };
}

export async function listSynthesisRegenerationProposals(client: PrismaClient = prisma) {
  return (await listSynthesisRegenerationProposalPage(client)).proposals;
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
            review: { select: { currentSynthesisVersionId: true, slug: true } },
            evaluation: true,
            acceptedReviewVersion: {
              select: {
                reviewId: true,
                synthesisDraftId: true,
                synthesisStalenessHead: {
                  select: { reviewId: true, currentEvaluationId: true, observedAt: true },
                },
                synthesisDraft: {
                  select: {
                    id: true,
                    seriesKey: true,
                    selectorJson: true,
                    selectorHash: true,
                    materializationPolicyVersion: true,
                    packetJson: true,
                    packetHash: true,
                  },
                },
              },
            },
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
        if (
          !(await getPublicSynthesisReview(proposal.review.slug, tx as unknown as PrismaClient))
        ) {
          throw new SynthesisStalenessError(
            "Accepted synthesis baseline is no longer valid.",
            "conflict",
          );
        }
        const observation = proposal.acceptedReviewVersion.synthesisStalenessHead;
        const draft = proposal.acceptedReviewVersion.synthesisDraft;
        if (!observation || !draft) {
          throw new SynthesisStalenessError(
            "Proposal evaluation is no longer current.",
            "conflict",
          );
        }
        const validated = validateStoredSynthesisStaleness(
          proposal.evaluation,
          {
            reviewId: proposal.reviewId,
            acceptedReviewVersionId: proposal.acceptedReviewVersionId,
            acceptedDraftId: draft.id,
            seriesKey: draft.seriesKey,
            selectorJson: draft.selectorJson,
            selectorHash: draft.selectorHash,
            materializationPolicyVersion: draft.materializationPolicyVersion,
            packetJson: draft.packetJson,
            packetHash: draft.packetHash,
          },
          observation.observedAt,
        );
        if (
          validated?.freshness.status !== "stale" ||
          proposal.acceptedReviewVersion.synthesisDraftId !== draft.id ||
          proposal.acceptedReviewVersion.reviewId !== proposal.reviewId ||
          observation.reviewId !== proposal.reviewId ||
          observation.currentEvaluationId !== proposal.evaluation.id
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
            idempotencyKey: `synthesis-regeneration-proposal:${proposal.id}:${input.idempotencyKey}`,
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
