import "server-only";
import { Prisma, type PrismaClient } from "@oratlas/db";
import { ZodError } from "zod";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  synthesisSelectorSchema,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_STALENESS_POLICY_VERSION,
  SYNTHESIS_STALENESS_REASON_CODES,
  type SubgraphEvidencePacket,
  type SynthesisStalenessAffectedReference,
  type SynthesisStalenessReasonCode,
} from "@oratlas/contracts";
import { compareSynthesisPackets } from "@oratlas/knowledge";
import type { SessionUser } from "./auth";
import { prisma } from "./db";
import {
  getPublicSynthesisReview,
  loadPreparedSynthesisPacket,
  SynthesisEditorialError,
} from "./synthesis-editorial";
import {
  SYNTHESIS_STALENESS_AFFECTED_REFERENCE_LIMIT,
  SYNTHESIS_STALENESS_SCAN_LIMIT,
  SynthesisStalenessError,
} from "./synthesis-staleness-contract";
import { assertEditor, compare, digest, runSerializable } from "./synthesis-staleness-runtime";

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
  const storedAffected = uniqueAffected.slice(0, SYNTHESIS_STALENESS_AFFECTED_REFERENCE_LIMIT);
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
  const limit = options.limit ?? SYNTHESIS_STALENESS_SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SYNTHESIS_STALENESS_SCAN_LIMIT) {
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
