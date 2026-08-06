import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@oratlas/db";
import {
  canonicalJson,
  synthesisGenerationRequestSchema,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_PIPELINE_SOFTWARE_ID,
  SYNTHESIS_PIPELINE_SOFTWARE_NAME,
  type EditorialSynthesisDraft,
  type SynthesisGenerationRequest,
  type SynthesisSelector,
} from "@oratlas/contracts";
import {
  assertCanonicalPreparedPacket,
  SYNTHESIS_PIPELINE_VERSION,
  synthesisGenerationKey,
  synthesisSelectionIdentity,
  verifySynthesisDocument,
  type PreparedSubgraphEvidencePacket,
  type SynthesisGenerationResult,
} from "@oratlas/knowledge";
import { prisma } from "./db";
import { generateSynthesisReview } from "./synthesis-writer";
import {
  SYNTHESIS_GENERATION_LEASE_MS,
  SynthesisEditorialError,
  type GenerateSynthesisDraftOptions,
} from "./synthesis-editorial-contract";
import { citationOccurrences, digest, synthesisSeriesKey } from "./synthesis-editorial-integrity";
import {
  assertEditorialActor,
  getEditorialSynthesisDraft,
  mapTransactionError,
  runSerializable,
} from "./synthesis-editorial-decisions";
import { loadPreparedSynthesisPacket } from "./synthesis-packets";

function assertSelectorPacketBinding(
  selector: SynthesisSelector,
  prepared: PreparedSubgraphEvidencePacket,
) {
  const packetSelection = prepared.packet.selection;
  const matches =
    selector.selection.kind === "seed"
      ? packetSelection.kind === "seed" && packetSelection.nodeId === selector.selection.nodeId
      : packetSelection.kind === "topic" &&
        packetSelection.canonicalQuery === selector.selection.canonicalQuery;
  if (!matches) {
    throw new SynthesisEditorialError(
      "Evidence packet does not match the claimed selector.",
      "conflict",
    );
  }
}

async function verifySuccessfulRun(
  client: PrismaClient,
  result: SynthesisGenerationResult,
  prepared: PreparedSubgraphEvidencePacket,
) {
  const run = await client.agentRun.findUnique({ where: { id: result.runId } });
  const output = canonicalJson(result.document);
  if (
    !run ||
    run.agentType !== "synthesis-review" ||
    run.status !== "succeeded" ||
    run.packetHash !== prepared.sha256 ||
    run.inputHash !== prepared.sha256 ||
    run.inputReferencesJson !== prepared.json ||
    run.promptHash !== result.promptHash ||
    run.promptVersion !== result.promptVersion ||
    run.modelProvider !== result.provider ||
    run.modelName !== result.model ||
    (run.modelVersion ?? "unavailable") !== (result.modelVersion ?? "unavailable") ||
    run.outputJson !== output ||
    digest(output) !== result.documentHash
  ) {
    throw new SynthesisEditorialError(
      "Successful generation provenance does not match.",
      "conflict",
    );
  }
  if (!run.completedAt) {
    throw new SynthesisEditorialError(
      "Successful generation is missing its completion time.",
      "conflict",
    );
  }
  return { ...run, completedAt: run.completedAt };
}

export async function generateSynthesisDraft(
  inputValue: SynthesisGenerationRequest,
  options: GenerateSynthesisDraftOptions = {},
): Promise<EditorialSynthesisDraft> {
  const input = synthesisGenerationRequestSchema.parse(inputValue);
  const client = options.client ?? prisma;
  if (options.actor) assertEditorialActor(options.actor);
  const selectorJson = canonicalJson(input.selector);
  const selectorHash = digest(selectorJson);
  const claimKey = digest(`synthesis-generation-request:${input.requestKey}`);
  const claimNow = options.now?.() ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? SYNTHESIS_GENERATION_LEASE_MS;
  const nextLeaseToken = randomUUID();
  const nextLeaseExpiresAt = new Date(claimNow.getTime() + leaseDurationMs);
  const existing = await client.synthesisDraft.findUnique({
    where: { requestKey: input.requestKey },
  });
  if (existing) {
    if (existing.selectorJson !== selectorJson || existing.selectorHash !== selectorHash) {
      throw new SynthesisEditorialError(
        "Request key is already bound to a different selector.",
        "conflict",
      );
    }
    return getEditorialSynthesisDraft(existing.id, client);
  }
  const claimResolution = await runSerializable(() =>
    client.$transaction(
      async (tx) => {
        if (options.actor) {
          const actor = await tx.user.findUnique({ where: { id: options.actor.id } });
          if (!actor || (actor.role !== "EDITOR" && actor.role !== "ADMIN")) {
            throw new SynthesisEditorialError("Editor role required.", "forbidden");
          }
        }
        const claim = await tx.synthesisGenerationRequestClaim.findUnique({
          where: { key: claimKey },
          include: { agentRun: true },
        });
        if (claim) {
          if (
            claim.requestKey !== input.requestKey ||
            claim.selectorJson !== selectorJson ||
            claim.selectorHash !== selectorHash
          ) {
            throw new SynthesisEditorialError(
              "Request key is already bound to a different selector.",
              "conflict",
            );
          }
          if (claim.status === "completed" && claim.draftId) return { draftId: claim.draftId };
          if (claim.agentRun?.status === "succeeded") {
            return { agentRunId: claim.agentRunId };
          }
          const leaseIsCurrent =
            claim.status === "running" &&
            claim.leaseExpiresAt !== null &&
            claim.leaseExpiresAt.getTime() > claimNow.getTime();
          if (leaseIsCurrent) {
            throw new SynthesisEditorialError(
              "This synthesis generation request is already running.",
              "conflict",
            );
          }
          if (claim.agentRun?.status === "running") {
            await tx.agentRun.updateMany({
              where: { id: claim.agentRun.id, status: "running" },
              data: {
                status: "failed",
                completedAt: claimNow,
                error: "lease-expired: Generation owner stopped before completion.",
              },
            });
          }
          const reclaimed = await tx.synthesisGenerationRequestClaim.updateMany({
            where: {
              key: claim.key,
              status: claim.status,
              leaseToken: claim.leaseToken,
              agentRunId: claim.agentRunId,
            },
            data: {
              status: "running",
              agentRunId: null,
              leaseToken: nextLeaseToken,
              leaseExpiresAt: nextLeaseExpiresAt,
              attempt: { increment: 1 },
              errorCode: null,
            },
          });
          if (reclaimed.count !== 1) {
            throw new SynthesisEditorialError(
              "Generation request lease changed concurrently.",
              "conflict",
            );
          }
          return { leaseToken: nextLeaseToken };
        }
        await tx.synthesisGenerationRequestClaim.create({
          data: {
            key: claimKey,
            requestKey: input.requestKey,
            selectorJson,
            selectorHash,
            leaseToken: nextLeaseToken,
            leaseExpiresAt: nextLeaseExpiresAt,
          },
        });
        return { leaseToken: nextLeaseToken };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  if (claimResolution.draftId) {
    return getEditorialSynthesisDraft(claimResolution.draftId, client);
  }
  if (!claimResolution.agentRunId) await options.afterRequestClaimed?.();

  let prepared: PreparedSubgraphEvidencePacket;
  let result: SynthesisGenerationResult;
  let successfulRun: Awaited<ReturnType<typeof verifySuccessfulRun>>;
  try {
    const resumedRun = claimResolution.agentRunId
      ? await client.agentRun.findUnique({ where: { id: claimResolution.agentRunId } })
      : null;
    prepared = claimResolution.agentRunId
      ? assertCanonicalPreparedPacket({
          packet: JSON.parse(resumedRun?.inputReferencesJson ?? "null") as never,
          json: resumedRun?.inputReferencesJson ?? "",
          sha256: resumedRun?.packetHash ?? "",
        })
      : assertCanonicalPreparedPacket(
          await (
            options.loadPacket ?? ((selector) => loadPreparedSynthesisPacket(selector, client))
          )(input.selector),
        );
    assertSelectorPacketBinding(input.selector, prepared);
    if (claimResolution.agentRunId) {
      const run = resumedRun;
      if (
        !run ||
        run.status !== "succeeded" ||
        !run.outputJson ||
        !run.packetHash ||
        !run.promptHash ||
        !run.promptVersion ||
        !run.modelProvider ||
        !run.modelName
      ) {
        throw new SynthesisEditorialError("Claimed generation run cannot be resumed.", "conflict");
      }
      const document = verifySynthesisDocument(JSON.parse(run.outputJson) as unknown, prepared);
      result = {
        document,
        runId: run.id,
        packetHash: run.packetHash,
        promptHash: run.promptHash,
        documentHash: digest(run.outputJson),
        generationKey: synthesisGenerationKey({
          packetHash: run.packetHash,
          promptVersion: run.promptVersion,
          promptHash: run.promptHash,
          provider: run.modelProvider,
          model: run.modelName,
          modelVersion: run.modelVersion ?? undefined,
        }),
        selectionIdentity: synthesisSelectionIdentity(prepared.packet),
        provider: run.modelProvider,
        model: run.modelName,
        modelVersion: run.modelVersion ?? undefined,
        promptVersion: run.promptVersion,
      };
    } else {
      if (!claimResolution.leaseToken) {
        throw new SynthesisEditorialError("Generation request lease is missing.", "conflict");
      }
      result = await generateSynthesisReview(prepared, options.provider, client, {
        key: claimKey,
        leaseToken: claimResolution.leaseToken,
      });
    }
    verifySynthesisDocument(result.document, prepared);
    successfulRun = await verifySuccessfulRun(client, result, prepared);
    const expectedGenerationKey = synthesisGenerationKey({
      packetHash: prepared.sha256,
      promptVersion: result.promptVersion,
      promptHash: result.promptHash,
      provider: result.provider,
      model: result.model,
      modelVersion: result.modelVersion,
    });
    if (expectedGenerationKey !== result.generationKey) {
      throw new SynthesisEditorialError(
        "Generation identity does not match its canonical inputs.",
        "conflict",
      );
    }
    if (result.selectionIdentity !== synthesisSelectionIdentity(prepared.packet)) {
      throw new SynthesisEditorialError(
        "Generation selection identity does not match its packet.",
        "conflict",
      );
    }
    if (!claimResolution.agentRunId) {
      const boundClaim = await client.synthesisGenerationRequestClaim.findUnique({
        where: { key: claimKey },
        select: { status: true, agentRunId: true },
      });
      if (boundClaim?.status !== "running" || boundClaim.agentRunId !== result.runId) {
        throw new SynthesisEditorialError(
          "Successful run was not atomically bound to its claim.",
          "conflict",
        );
      }
      await options.afterRunClaimed?.();
    }
  } catch (error) {
    const failedClaim = await client.synthesisGenerationRequestClaim.findUnique({
      where: { key: claimKey },
      include: { agentRun: { select: { status: true } } },
    });
    if (!failedClaim?.agentRunId || failedClaim.agentRun?.status === "failed") {
      await client.synthesisGenerationRequestClaim.updateMany({
        where: {
          key: claimKey,
          status: "running",
          leaseToken: claimResolution.leaseToken,
          agentRunId: failedClaim?.agentRunId ?? null,
        },
        data: {
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          errorCode: error instanceof Error ? error.name : "generation-failed",
        },
      });
    }
    throw error;
  }
  const seriesKey = synthesisSeriesKey(input.selector);

  try {
    const draftId = await client.$transaction(
      async (tx) => {
        const duplicate = await tx.synthesisDraft.findUnique({
          where: { requestKey: input.requestKey },
        });
        if (duplicate) return duplicate.id;
        const latest = await tx.synthesisDraft.findFirst({
          where: { seriesKey },
          orderBy: { regenerationOrdinal: "desc" },
        });
        const seriesReview = await tx.review.findUnique({
          where: { synthesisSeriesKey: seriesKey },
          include: {
            currentSynthesisVersion: {
              select: {
                id: true,
                reviewId: true,
                recordSourceType: true,
                snapshotId: true,
                synthesisOrdinal: true,
                synthesisDraftId: true,
                synthesisDraft: { select: { seriesKey: true, status: true, reviewId: true } },
              },
            },
          },
        });
        const previousAccepted = seriesReview?.currentSynthesisVersion;
        if (
          seriesReview &&
          (seriesReview.reviewType !== "ai-synthesis" ||
            seriesReview.repositoryId !== null ||
            seriesReview.currentSnapshotId !== null ||
            !previousAccepted ||
            previousAccepted.reviewId !== seriesReview.id ||
            previousAccepted.recordSourceType !== "synthesis" ||
            previousAccepted.snapshotId !== null ||
            !previousAccepted.synthesisOrdinal ||
            !previousAccepted.synthesisDraftId ||
            previousAccepted.synthesisDraft?.seriesKey !== seriesKey ||
            previousAccepted.synthesisDraft.status !== "accepted" ||
            previousAccepted.synthesisDraft.reviewId !== seriesReview.id)
        ) {
          throw new SynthesisEditorialError(
            "Current synthesis series head is invalid.",
            "conflict",
          );
        }
        const regenerationOrdinal = (latest?.regenerationOrdinal ?? 0) + 1;
        const references = new Map(
          prepared.packet.references.map((reference) => [reference.referenceId, reference]),
        );
        const nodes = new Map(prepared.packet.nodes.map((node) => [node.id, node]));
        const occurrences = citationOccurrences(result.document);
        const draft = await tx.synthesisDraft.create({
          data: {
            seriesKey,
            selectorJson,
            selectorHash,
            materializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
            generationKey: result.generationKey,
            regenerationOrdinal,
            parentDraftId: latest?.status === "regeneration-requested" ? latest.id : undefined,
            previousAcceptedDraftId: previousAccepted?.synthesisDraftId ?? undefined,
            previousAcceptedOrdinal: previousAccepted?.synthesisOrdinal ?? undefined,
            agentRunId: result.runId,
            packetJson: prepared.json,
            packetHash: result.packetHash,
            documentJson: canonicalJson(result.document),
            documentHash: result.documentHash,
            generationMode: result.provider === "deterministic" ? "deterministic-template" : "llm",
            pipelineSoftwareId: SYNTHESIS_PIPELINE_SOFTWARE_ID,
            pipelineSoftwareKind: "software-agent",
            pipelineSoftwareName: SYNTHESIS_PIPELINE_SOFTWARE_NAME,
            pipelineSoftwareVersion: SYNTHESIS_PIPELINE_VERSION,
            provider: result.provider,
            model: result.model,
            modelVersion: result.modelVersion ?? "unavailable",
            promptVersion: result.promptVersion,
            promptHash: result.promptHash,
            generatedAt: successfulRun.completedAt,
            attributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
            requestKey: input.requestKey,
            memberships: {
              create: prepared.packet.references.map((reference, position) => ({
                referenceId: reference.referenceId,
                kind: reference.kind,
                nodeId: reference.nodeId,
                nodeVersionId: reference.nodeVersionId,
                identifierScheme: reference.kind === "identifier" ? reference.scheme : undefined,
                identifierRole: reference.kind === "identifier" ? reference.role : undefined,
                identifierValue: reference.kind === "identifier" ? reference.value : undefined,
                position,
              })),
            },
            citations: {
              create: occurrences.map((occurrence) => {
                const reference = references.get(occurrence.citation.referenceId)!;
                const node = nodes.get(occurrence.citation.nodeId)!;
                return {
                  occurrenceKey: `${occurrence.location}:${occurrence.citationIndex}`,
                  location: occurrence.location,
                  sectionId: occurrence.sectionId,
                  paragraphIndex: occurrence.paragraphIndex,
                  citationIndex: occurrence.citationIndex,
                  referenceId: occurrence.citation.referenceId,
                  nodeId: occurrence.citation.nodeId,
                  nodeVersionId: occurrence.citation.nodeVersionId,
                  nodeKind: node.kind,
                  nodeTitle: node.title,
                  identifierScheme: reference.kind === "identifier" ? reference.scheme : undefined,
                  identifierRole: reference.kind === "identifier" ? reference.role : undefined,
                  identifierValue: reference.kind === "identifier" ? reference.value : undefined,
                };
              }),
            },
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: options.actor?.id,
            action: "synthesis.draft.generated",
            subjectType: "synthesisDraft",
            subjectId: draft.id,
            idempotencyKey: `synthesis-generation:${input.requestKey}`,
            detailsJson: canonicalJson({
              seriesKey,
              regenerationOrdinal,
              packetHash: result.packetHash,
              documentHash: result.documentHash,
            }),
          },
        });
        const completed = await tx.synthesisGenerationRequestClaim.updateMany({
          where: { key: claimKey, status: "running", selectorHash, agentRunId: result.runId },
          data: {
            status: "completed",
            draftId: draft.id,
            leaseToken: null,
            leaseExpiresAt: null,
            errorCode: null,
          },
        });
        if (completed.count !== 1) {
          throw new SynthesisEditorialError(
            "Generation request claim changed concurrently.",
            "conflict",
          );
        }
        return draft.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return getEditorialSynthesisDraft(draftId, client);
  } catch (error) {
    const duplicate = await client.synthesisDraft.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (duplicate) return getEditorialSynthesisDraft(duplicate.id, client);
    throw mapTransactionError(error);
  }
}
