import "server-only";
import { Prisma, type PrismaClient } from "@oratlas/db";
import {
  canonicalJson,
  editorialSynthesisDraftSchema,
  liveSynthesisDoiPairSchema,
  subgraphEvidencePacketSchema,
  synthesisDraftDecisionSchema,
  synthesisSelectorSchema,
  SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  type SYNTHESIS_PIPELINE_SOFTWARE_ID,
  type SYNTHESIS_PIPELINE_SOFTWARE_NAME,
  type EditorialSynthesisDraft,
  type SynthesisDraftDecision,
} from "@oratlas/contracts";
import {
  assertCanonicalPreparedPacket,
  synthesisGenerationKey,
  verifySynthesisDocument,
  type PreparedSubgraphEvidencePacket,
} from "@oratlas/knowledge";
import type { SessionUser } from "./auth";
import { prisma } from "./db";
import { prismaCode, withPrismaRetryPolicy } from "./db-retry";
import { materializeCanonicalReviewGraph } from "./canonical-graph-materialization";
import {
  SYNTHESIS_TRANSACTION_ATTEMPTS,
  SynthesisEditorialError,
} from "./synthesis-editorial-contract";
import { citationOccurrences, digest, synthesisSeriesKey } from "./synthesis-editorial-integrity";

export function parseStoredPrepared(row: {
  packetJson: string;
  packetHash: string;
}): PreparedSubgraphEvidencePacket {
  let value: unknown;
  try {
    value = JSON.parse(row.packetJson);
  } catch {
    throw new SynthesisEditorialError("Stored evidence packet is invalid.", "conflict");
  }
  const parsed = subgraphEvidencePacketSchema.safeParse(value);
  if (!parsed.success)
    throw new SynthesisEditorialError("Stored evidence packet is invalid.", "conflict");
  return assertCanonicalPreparedPacket({
    packet: parsed.data,
    json: row.packetJson,
    sha256: row.packetHash,
  });
}

export function parseStoredDocument(
  row: { documentJson: string; documentHash: string },
  prepared: PreparedSubgraphEvidencePacket,
) {
  let value: unknown;
  try {
    value = JSON.parse(row.documentJson);
  } catch {
    throw new SynthesisEditorialError("Stored synthesis document is invalid.", "conflict");
  }
  const document = verifySynthesisDocument(value, prepared);
  if (
    canonicalJson(document) !== row.documentJson ||
    digest(row.documentJson) !== row.documentHash
  ) {
    throw new SynthesisEditorialError("Stored synthesis document hash does not match.", "conflict");
  }
  return document;
}

export async function loadDraft(client: PrismaClient, id: string) {
  return client.synthesisDraft.findUnique({
    where: { id },
    include: {
      agentRun: true,
      acceptedBy: { select: { githubLogin: true, displayName: true, role: true } },
      memberships: {
        orderBy: { position: "asc" },
        include: { nodeVersion: { select: { knowledgeNodeId: true } } },
      },
      citations: {
        orderBy: [{ location: "asc" }, { citationIndex: "asc" }],
        include: { nodeVersion: { select: { knowledgeNodeId: true } } },
      },
      reviewVersion: { select: { id: true, synthesisOrdinal: true } },
    },
  });
}

export type LoadedDraft = NonNullable<Awaited<ReturnType<typeof loadDraft>>>;

export function assertDraftIntegrity(row: LoadedDraft) {
  const prepared = parseStoredPrepared(row);
  const document = parseStoredDocument(row, prepared);
  const selector = synthesisSelectorSchema.safeParse(JSON.parse(row.selectorJson) as unknown);
  if (
    !selector.success ||
    canonicalJson(selector.data) !== row.selectorJson ||
    digest(row.selectorJson) !== row.selectorHash ||
    synthesisSeriesKey(selector.data) !== row.seriesKey
  ) {
    throw new SynthesisEditorialError("Stored synthesis selector does not match.", "conflict");
  }
  const run = row.agentRun;
  if (
    run.status !== "succeeded" ||
    run.agentType !== "synthesis-review" ||
    run.packetHash !== row.packetHash ||
    run.inputHash !== row.packetHash ||
    run.inputReferencesJson !== row.packetJson ||
    run.outputJson !== row.documentJson ||
    run.promptVersion !== row.promptVersion ||
    run.promptHash !== row.promptHash ||
    run.modelProvider !== row.provider ||
    run.modelName !== row.model ||
    (run.modelVersion ?? "unavailable") !== row.modelVersion ||
    !run.completedAt ||
    run.completedAt.getTime() !== row.generatedAt.getTime() ||
    synthesisGenerationKey({
      packetHash: row.packetHash,
      promptVersion: row.promptVersion,
      promptHash: row.promptHash,
      provider: row.provider,
      model: row.model,
      modelVersion: run.modelVersion ?? undefined,
    }) !== row.generationKey
  ) {
    throw new SynthesisEditorialError("Stored AgentRun does not match the draft.", "conflict");
  }
  const references = new Map(
    prepared.packet.references.map((reference) => [reference.referenceId, reference]),
  );
  if (row.memberships.length !== references.size) {
    throw new SynthesisEditorialError("Stored draft membership is incomplete.", "conflict");
  }
  for (const membership of row.memberships) {
    const reference = references.get(membership.referenceId);
    const hasStoredIdentifier =
      membership.identifierScheme !== null ||
      membership.identifierRole !== null ||
      membership.identifierValue !== null;
    if (
      !reference ||
      membership.nodeVersion.knowledgeNodeId !== membership.nodeId ||
      reference.kind !== membership.kind ||
      reference.nodeId !== membership.nodeId ||
      reference.nodeVersionId !== membership.nodeVersionId ||
      (reference.kind === "node" && hasStoredIdentifier) ||
      (reference.kind === "identifier" &&
        (reference.scheme !== membership.identifierScheme ||
          reference.role !== membership.identifierRole ||
          reference.value !== membership.identifierValue))
    ) {
      throw new SynthesisEditorialError(
        "Stored draft membership does not match the packet.",
        "conflict",
      );
    }
  }
  const expectedOccurrences = citationOccurrences(document);
  if (expectedOccurrences.length !== row.citations.length) {
    throw new SynthesisEditorialError("Stored citation occurrences are incomplete.", "conflict");
  }
  const occurrenceByKey = new Map(
    row.citations.map((citation) => [`${citation.location}:${citation.citationIndex}`, citation]),
  );
  for (const occurrence of expectedOccurrences) {
    const stored = occurrenceByKey.get(`${occurrence.location}:${occurrence.citationIndex}`);
    const reference = references.get(occurrence.citation.referenceId);
    const node = prepared.packet.nodes.find(
      (candidate) => candidate.id === occurrence.citation.nodeId,
    );
    const hasStoredIdentifier =
      stored?.identifierScheme !== null ||
      stored?.identifierRole !== null ||
      stored?.identifierValue !== null;
    if (
      !stored ||
      !reference ||
      !node ||
      stored.nodeVersion.knowledgeNodeId !== stored.nodeId ||
      stored.referenceId !== occurrence.citation.referenceId ||
      stored.nodeId !== occurrence.citation.nodeId ||
      stored.nodeVersionId !== occurrence.citation.nodeVersionId ||
      stored.nodeKind !== node.kind ||
      stored.nodeTitle !== node.title ||
      (reference.kind === "node" && hasStoredIdentifier) ||
      (reference.kind === "identifier" &&
        (stored.identifierScheme !== reference.scheme ||
          stored.identifierRole !== reference.role ||
          stored.identifierValue !== reference.value))
    ) {
      throw new SynthesisEditorialError("Stored citation occurrence does not match.", "conflict");
    }
  }
  return { prepared, document, selector: selector.data };
}

export function draftProvenance(row: LoadedDraft) {
  return {
    generationMode: row.generationMode as "llm" | "deterministic-template",
    pipelineSoftware: {
      id: row.pipelineSoftwareId as typeof SYNTHESIS_PIPELINE_SOFTWARE_ID,
      kind: row.pipelineSoftwareKind as "software-agent",
      displayName: row.pipelineSoftwareName as typeof SYNTHESIS_PIPELINE_SOFTWARE_NAME,
      pipelineVersion: row.pipelineSoftwareVersion,
    },
    provider: row.provider,
    model: row.model,
    modelVersion: row.modelVersion,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    packetHash: row.packetHash,
    documentHash: row.documentHash,
    generatedAt: row.generatedAt.toISOString(),
    attributionPolicyVersion: row.attributionPolicyVersion,
    materializationPolicyVersion: row.materializationPolicyVersion,
  };
}

export function draftCitationDtos(row: LoadedDraft) {
  return row.citations.map((citation, occurrenceOrdinal) => ({
    referenceId: citation.referenceId,
    nodeId: citation.nodeId,
    nodeVersionId: citation.nodeVersionId,
    nodeKind: citation.nodeKind as "claim" | "figure" | "dataset" | "code",
    title: citation.nodeTitle,
    location: citation.location,
    occurrenceOrdinal,
    identifierScheme: citation.identifierScheme ?? undefined,
    identifierRole: citation.identifierRole ?? undefined,
    identifierValue: citation.identifierValue ?? undefined,
  }));
}

export async function getEditorialSynthesisDraft(
  id: string,
  client: PrismaClient = prisma,
): Promise<EditorialSynthesisDraft> {
  const row = await loadDraft(client, id);
  if (!row) throw new SynthesisEditorialError("Synthesis draft not found.", "not-found");
  const { document, selector } = assertDraftIntegrity(row);
  return editorialSynthesisDraftSchema.parse({
    id: row.id,
    status: row.status,
    revision: row.revision,
    seriesKey: row.seriesKey,
    selector,
    generationKey: row.generationKey,
    regenerationOrdinal: row.regenerationOrdinal,
    parentDraftId: row.parentDraftId ?? undefined,
    previousAcceptedOrdinal: row.previousAcceptedOrdinal ?? undefined,
    document,
    provenance: draftProvenance(row),
    citations: draftCitationDtos(row),
  });
}

export async function listEditorialSynthesisDrafts(
  client: PrismaClient = prisma,
): Promise<EditorialSynthesisDraft[]> {
  const rows = await client.synthesisDraft.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return Promise.all(rows.map((row) => getEditorialSynthesisDraft(row.id, client)));
}

export function assertEditorialActor(
  actor: SessionUser,
): asserts actor is SessionUser & { role: "EDITOR" | "ADMIN" } {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new SynthesisEditorialError("Editor role required.", "forbidden");
  }
}

export async function runSerializable<T>(operation: () => Promise<T>): Promise<T> {
  return withPrismaRetryPolicy(operation, {
    maxAttempts: SYNTHESIS_TRANSACTION_ATTEMPTS,
    isRetryable: (error) => ["P1008", "P2002", "P2028", "P2034"].includes(prismaCode(error) ?? ""),
    mapExhaustedError: mapTransactionError,
  });
}

export function mapTransactionError(error: unknown): Error {
  if (error instanceof SynthesisEditorialError) return error;
  const code = prismaCode(error);
  if (["P1008", "P2002", "P2028", "P2034"].includes(code ?? "")) {
    return new SynthesisEditorialError(
      "Synthesis state changed concurrently; reload and retry.",
      "conflict",
    );
  }
  return error instanceof Error ? error : new Error("Synthesis transaction failed.");
}

function slugForSeries(seriesKey: string): string {
  return `synthesis-${seriesKey.slice(0, 20)}`;
}

export async function decideSynthesisDraft(
  draftId: string,
  inputValue: SynthesisDraftDecision,
  actor: SessionUser,
  client: PrismaClient = prisma,
): Promise<{ status: string; revision: number; reviewSlug?: string; reviewVersionId?: string }> {
  assertEditorialActor(actor);
  const input = synthesisDraftDecisionSchema.parse(inputValue);
  const operationKey = `synthesis-decision:${draftId}:${input.idempotencyKey}`;
  const operationHash = digest(canonicalJson(input));

  return runSerializable(() =>
    client.$transaction(
      async (tx) => {
        const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
        if (!currentActor || (currentActor.role !== "EDITOR" && currentActor.role !== "ADMIN")) {
          throw new SynthesisEditorialError("Editor role required.", "forbidden");
        }
        const priorClaim = await tx.idempotencyKey.findUnique({ where: { key: operationKey } });
        const draft = await tx.synthesisDraft.findUnique({
          where: { id: draftId },
          include: {
            agentRun: true,
            memberships: {
              orderBy: { position: "asc" },
              include: { nodeVersion: { select: { knowledgeNodeId: true } } },
            },
            citations: {
              orderBy: [{ location: "asc" }, { citationIndex: "asc" }],
              include: { nodeVersion: { select: { knowledgeNodeId: true } } },
            },
            acceptedBy: { select: { githubLogin: true, displayName: true, role: true } },
            reviewVersion: {
              select: { id: true, synthesisOrdinal: true, review: { select: { slug: true } } },
            },
          },
        });
        if (!draft) throw new SynthesisEditorialError("Synthesis draft not found.", "not-found");
        if (priorClaim) {
          if (priorClaim.requestHash !== operationHash) {
            throw new SynthesisEditorialError(
              "Idempotency key is bound to a different decision.",
              "conflict",
            );
          }
          return {
            status: draft.status,
            revision: draft.revision,
            reviewSlug: draft.reviewVersion?.review.slug,
            reviewVersionId: draft.reviewVersion?.id,
          };
        }
        if (draft.status !== "pending" || draft.revision !== input.expectedRevision) {
          throw new SynthesisEditorialError("Draft changed; reload before deciding.", "conflict");
        }
        // Reuse the same fail-closed checks on the transaction snapshot.
        const integrity = assertDraftIntegrity(draft as LoadedDraft);
        await tx.idempotencyKey.create({ data: { key: operationKey, requestHash: operationHash } });
        const nextRevision = draft.revision + 1;
        const claimed = await tx.synthesisDraft.updateMany({
          where: { id: draft.id, status: "pending", revision: input.expectedRevision },
          data: { revision: nextRevision },
        });
        if (claimed.count !== 1) {
          throw new SynthesisEditorialError(
            "Draft changed concurrently; reload and retry.",
            "conflict",
          );
        }

        if (input.action !== "accept") {
          const status = input.action === "reject" ? "rejected" : "regeneration-requested";
          await tx.synthesisDraft.update({
            where: { id: draft.id },
            data: { status, decisionRationale: input.rationale },
          });
          await tx.agentRun.update({
            where: { id: draft.agentRunId },
            data: { humanReviewStatus: "rejected" },
          });
          await tx.auditEvent.create({
            data: {
              actorId: currentActor.id,
              action:
                input.action === "reject"
                  ? "synthesis.draft.rejected"
                  : "synthesis.draft.regeneration-requested",
              subjectType: "synthesisDraft",
              subjectId: draft.id,
              idempotencyKey: operationKey,
              detailsJson: canonicalJson({ revision: nextRevision, rationale: input.rationale }),
            },
          });
          return { status, revision: nextRevision };
        }

        const existingReview = await tx.review.findUnique({
          where: { synthesisSeriesKey: draft.seriesKey },
          include: {
            currentSynthesisVersion: {
              select: {
                id: true,
                reviewId: true,
                recordSourceType: true,
                synthesisOrdinal: true,
                synthesisDraftId: true,
                acceptedPredecessorVersionId: true,
                versionDoi: true,
                conceptDoi: true,
                synthesisDraft: {
                  select: {
                    id: true,
                    status: true,
                    reviewId: true,
                    versionDoi: true,
                    conceptDoi: true,
                  },
                },
              },
            },
          },
        });
        const previousVersion = existingReview?.currentSynthesisVersion;
        if (
          existingReview &&
          (!previousVersion ||
            existingReview.reviewType !== "ai-synthesis" ||
            existingReview.repositoryId !== null ||
            existingReview.currentSnapshotId !== null ||
            previousVersion.reviewId !== existingReview.id ||
            previousVersion.recordSourceType !== "synthesis" ||
            !previousVersion.synthesisOrdinal ||
            !previousVersion.synthesisDraftId)
        ) {
          throw new SynthesisEditorialError(
            "Current synthesis head has invalid source lineage.",
            "conflict",
          );
        }
        if (
          (draft.previousAcceptedDraftId ?? null) !== (previousVersion?.synthesisDraftId ?? null)
        ) {
          throw new SynthesisEditorialError(
            "Draft was generated from a stale accepted synthesis head.",
            "conflict",
          );
        }
        let canonicalSeriesConceptDoi: string | null = null;
        if (existingReview && previousVersion) {
          const acceptedHistory = await tx.reviewVersion.findMany({
            where: { reviewId: existingReview.id, recordSourceType: "synthesis" },
            orderBy: { synthesisOrdinal: "asc" },
            select: {
              id: true,
              synthesisOrdinal: true,
              versionDoi: true,
              conceptDoi: true,
              synthesisDraft: {
                select: {
                  id: true,
                  status: true,
                  reviewId: true,
                  versionDoi: true,
                  conceptDoi: true,
                },
              },
            },
          });
          const historicalConcepts = new Set<string>();
          if (acceptedHistory.at(-1)?.id !== previousVersion.id) {
            throw new SynthesisEditorialError(
              "Current synthesis head is not the latest accepted series version.",
              "conflict",
            );
          }
          for (const acceptedVersion of acceptedHistory) {
            const acceptedDraft = acceptedVersion.synthesisDraft;
            const doiPair = liveSynthesisDoiPairSchema.safeParse({
              versionDoi: acceptedVersion.versionDoi ?? undefined,
              conceptDoi: acceptedVersion.conceptDoi ?? undefined,
            });
            if (
              !acceptedVersion.synthesisOrdinal ||
              !acceptedDraft ||
              acceptedDraft.status !== "accepted" ||
              acceptedDraft.reviewId !== existingReview.id ||
              acceptedVersion.versionDoi !== acceptedDraft.versionDoi ||
              acceptedVersion.conceptDoi !== acceptedDraft.conceptDoi ||
              !doiPair.success ||
              (doiPair.data.versionDoi ?? null) !== acceptedVersion.versionDoi ||
              (doiPair.data.conceptDoi ?? null) !== acceptedVersion.conceptDoi
            ) {
              throw new SynthesisEditorialError(
                "Accepted synthesis DOI lineage is corrupt.",
                "conflict",
              );
            }
            if (acceptedVersion.conceptDoi) historicalConcepts.add(acceptedVersion.conceptDoi);
          }
          if (historicalConcepts.size > 1) {
            throw new SynthesisEditorialError(
              "Accepted synthesis history has inconsistent concept DOI roles.",
              "conflict",
            );
          }
          canonicalSeriesConceptDoi = historicalConcepts.values().next().value ?? null;
          if ((previousVersion.conceptDoi ?? null) !== canonicalSeriesConceptDoi) {
            throw new SynthesisEditorialError(
              "Current synthesis head does not match the canonical series concept DOI.",
              "conflict",
            );
          }
        }
        const ordinal = (previousVersion?.synthesisOrdinal ?? 0) + 1;
        const slug = slugForSeries(draft.seriesKey);
        if (previousVersion && canonicalSeriesConceptDoi !== (input.conceptDoi ?? null)) {
          throw new SynthesisEditorialError(
            "Concept DOI must remain stable for the synthesis series.",
            "conflict",
          );
        }
        if (input.versionDoi) {
          const reused = await tx.reviewVersion.findFirst({
            where: {
              recordSourceType: "synthesis",
              OR: [{ versionDoi: input.versionDoi }, { conceptDoi: input.versionDoi }],
            },
            select: { id: true },
          });
          if (reused) {
            throw new SynthesisEditorialError(
              "Version DOI is already assigned to a synthesis identifier.",
              "conflict",
            );
          }
        }
        if (input.conceptDoi) {
          const crossRole = await tx.reviewVersion.findFirst({
            where: { recordSourceType: "synthesis", versionDoi: input.conceptDoi },
            select: { id: true },
          });
          const otherSeries = await tx.reviewVersion.findFirst({
            where: {
              recordSourceType: "synthesis",
              conceptDoi: input.conceptDoi,
              ...(existingReview ? { reviewId: { not: existingReview.id } } : {}),
            },
            select: { id: true },
          });
          if (crossRole || otherSeries) {
            throw new SynthesisEditorialError(
              "Concept DOI is already assigned to another synthesis role or series.",
              "conflict",
            );
          }
        }
        let review = existingReview;
        if (!review) {
          review = await tx.review.create({
            data: {
              slug,
              synthesisSeriesKey: draft.seriesKey,
              title: integrity.document.title,
              abstract: integrity.document.summary,
              reviewType: "ai-synthesis",
              licenseSpdx: input.licenseSpdx,
              status: "published",
              acceptedAt: new Date(),
            },
            include: {
              currentSynthesisVersion: {
                select: {
                  id: true,
                  reviewId: true,
                  recordSourceType: true,
                  synthesisOrdinal: true,
                  synthesisDraftId: true,
                  acceptedPredecessorVersionId: true,
                  versionDoi: true,
                  conceptDoi: true,
                  synthesisDraft: {
                    select: {
                      id: true,
                      status: true,
                      reviewId: true,
                      versionDoi: true,
                      conceptDoi: true,
                    },
                  },
                },
              },
            },
          });
        }
        if (
          review.repositoryId ||
          review.currentSnapshotId ||
          review.reviewType !== "ai-synthesis"
        ) {
          throw new SynthesisEditorialError(
            "Review source identity is not a synthesis series.",
            "conflict",
          );
        }
        const acceptedAt = new Date();
        const version = await tx.reviewVersion.create({
          data: {
            reviewId: review.id,
            recordSourceType: "synthesis",
            synthesisDraftId: draft.id,
            sourceSelectionKey: `${draft.seriesKey}:${ordinal}`,
            title: integrity.document.title,
            abstract: integrity.document.summary,
            metadataJson: canonicalJson({ reviewType: "ai-synthesis", license: input.licenseSpdx }),
            isExample: false,
            publishedAt: acceptedAt,
            synthesisDocumentJson: draft.documentJson,
            synthesisOrdinal: ordinal,
            synthesisGenerationMode: draft.generationMode,
            synthesisPipelineId: draft.pipelineSoftwareId,
            synthesisPipelineKind: draft.pipelineSoftwareKind,
            synthesisPipelineName: draft.pipelineSoftwareName,
            synthesisPipelineVersion: draft.pipelineSoftwareVersion,
            synthesisProvider: draft.provider,
            synthesisModel: draft.model,
            synthesisModelVersion: draft.modelVersion,
            synthesisPromptVersion: draft.promptVersion,
            synthesisPromptHash: draft.promptHash,
            synthesisPacketHash: draft.packetHash,
            synthesisDocumentHash: draft.documentHash,
            synthesisGeneratedAt: draft.generatedAt,
            synthesisAcceptedAt: acceptedAt,
            synthesisApprovedById: currentActor.id,
            synthesisApproverRole: currentActor.role,
            synthesisApproverDisplayName: currentActor.displayName ?? currentActor.githubLogin,
            synthesisApproverGithubLogin: currentActor.githubLogin,
            synthesisChecklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
            synthesisAttributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
            synthesisMaterializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
            synthesisRightsStatement: input.rightsStatement,
            synthesisLicenseSpdx: input.licenseSpdx,
            versionDoi: input.versionDoi,
            conceptDoi: input.conceptDoi,
            acceptedPredecessorVersionId: previousVersion?.id,
            synthesisAttributions: {
              create: [
                {
                  position: 0,
                  kind: "software-agent",
                  displayName: draft.pipelineSoftwareName,
                  role: "synthesis-generation",
                  softwareVersion: draft.pipelineSoftwareVersion,
                },
                {
                  position: 1,
                  kind: "approving-editor",
                  displayName: currentActor.displayName ?? currentActor.githubLogin,
                  role: "editorial-approval",
                  userId: currentActor.id,
                  userRoleSnapshot: currentActor.role,
                  githubLoginSnapshot: currentActor.githubLogin,
                },
              ],
            },
          },
        });
        await tx.review.update({
          where: { id: review.id },
          data: {
            currentSynthesisVersionId: version.id,
            title: version.title,
            abstract: version.abstract,
            licenseSpdx: input.licenseSpdx,
            acceptedAt,
          },
        });
        await materializeCanonicalReviewGraph(tx, version.id);
        const supersededRegenerationProposals = await tx.synthesisRegenerationProposal.findMany({
          where: {
            reviewId: review.id,
            status: "open",
            acceptedReviewVersionId: { not: version.id },
          },
          select: { id: true, acceptedReviewVersionId: true },
        });
        await tx.synthesisRegenerationProposal.updateMany({
          where: {
            reviewId: review.id,
            status: "open",
            acceptedReviewVersionId: { not: version.id },
          },
          data: { status: "superseded", openHeadKey: null },
        });
        await tx.synthesisDraft.update({
          where: { id: draft.id },
          data: {
            status: "accepted",
            acceptedAt,
            acceptedById: currentActor.id,
            acceptedByRoleSnapshot: currentActor.role,
            acceptedByDisplayName: currentActor.displayName ?? currentActor.githubLogin,
            acceptedByGithubLogin: currentActor.githubLogin,
            decisionRationale: input.rationale,
            checklistJson: canonicalJson(input.checklist),
            checklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
            rightsStatement: input.rightsStatement,
            licenseSpdx: input.licenseSpdx,
            versionDoi: input.versionDoi,
            conceptDoi: input.conceptDoi,
            reviewId: review.id,
          },
        });
        await tx.agentRun.update({
          where: { id: draft.agentRunId },
          data: { humanReviewStatus: "approved" },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              actorId: currentActor.id,
              action: "synthesis.draft.accepted",
              subjectType: "synthesisDraft",
              subjectId: draft.id,
              idempotencyKey: operationKey,
              detailsJson: canonicalJson({
                reviewId: review.id,
                reviewVersionId: version.id,
                ordinal,
              }),
            },
            {
              actorId: currentActor.id,
              action: "review.synthesis-published",
              subjectType: "reviewVersion",
              subjectId: version.id,
              idempotencyKey: `${operationKey}:published`,
              detailsJson: canonicalJson({
                reviewSlug: review.slug,
                seriesKey: draft.seriesKey,
                ordinal,
              }),
            },
            ...supersededRegenerationProposals.map((proposal) => ({
              actorId: currentActor.id,
              action: "synthesis.regeneration-proposal.superseded",
              subjectType: "synthesisRegenerationProposal",
              subjectId: proposal.id,
              idempotencyKey: `synthesis-staleness:proposal:${proposal.id}:superseded:head:${version.id}`,
              detailsJson: canonicalJson({
                cause: "accepted-head-changed",
                reviewId: review.id,
                previousAcceptedReviewVersionId: proposal.acceptedReviewVersionId,
                currentAcceptedReviewVersionId: version.id,
              }),
            })),
          ],
        });
        return {
          status: "accepted",
          revision: nextRevision,
          reviewSlug: review.slug,
          reviewVersionId: version.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
