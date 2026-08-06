import "server-only";
import type { PrismaClient } from "@oratlas/db";
import {
  canonicalJson,
  synthesisRegenerationProposalDecisionSchema,
  synthesisRegenerationProposalSchema,
  type SynthesisRegenerationProposalDecision,
} from "@oratlas/contracts";
import type { SessionUser } from "./auth";
import { prisma } from "./db";
import { SERIALIZABLE_TRANSACTION_OPTIONS } from "./db-retry";
import { getPublicSynthesisReview } from "./synthesis-editorial";
import { validateStoredSynthesisStaleness } from "./synthesis-staleness-integrity";
import {
  SYNTHESIS_STALENESS_SCAN_LIMIT,
  SynthesisStalenessError,
} from "./synthesis-staleness-contract";
import { assertEditor, digest, runSerializable } from "./synthesis-staleness-runtime";

export async function listSynthesisRegenerationProposalPage(
  client: PrismaClient = prisma,
  options: { cursor?: string; limit?: number } = {},
) {
  const limit = options.limit ?? SYNTHESIS_STALENESS_SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SYNTHESIS_STALENESS_SCAN_LIMIT) {
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
    client.$transaction(async (tx) => {
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
      if (!(await getPublicSynthesisReview(proposal.review.slug, tx as unknown as PrismaClient))) {
        throw new SynthesisStalenessError(
          "Accepted synthesis baseline is no longer valid.",
          "conflict",
        );
      }
      const observation = proposal.acceptedReviewVersion.synthesisStalenessHead;
      const draft = proposal.acceptedReviewVersion.synthesisDraft;
      if (!observation || !draft) {
        throw new SynthesisStalenessError("Proposal evaluation is no longer current.", "conflict");
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
        throw new SynthesisStalenessError("Proposal evaluation is no longer current.", "conflict");
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
    }, SERIALIZABLE_TRANSACTION_OPTIONS),
  );
}
