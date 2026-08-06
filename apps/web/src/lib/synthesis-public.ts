import "server-only";
import { Prisma, type PrismaClient } from "@oratlas/db";
import {
  isSupportedSynthesisAcceptanceChecklist,
  publicSynthesisReviewSchema,
  SYNTHESIS_STALENESS_POLICY_VERSION,
  type PublicSynthesisReview,
} from "@oratlas/contracts";
import { prisma } from "./db";
import { validateStoredSynthesisStaleness } from "./synthesis-staleness-integrity";
import {
  assertDraftIntegrity,
  draftCitationDtos,
  type LoadedDraft,
} from "./synthesis-editorial-decisions";

const publicSynthesisVersionInclude = Prisma.validator<Prisma.ReviewVersionInclude>()({
  acceptedPredecessor: {
    select: {
      id: true,
      reviewId: true,
      recordSourceType: true,
      synthesisOrdinal: true,
      synthesisDraftId: true,
    },
  },
  synthesisAttributions: { orderBy: { position: "asc" } },
  synthesisStalenessHead: {
    include: { currentEvaluation: true },
  },
  synthesisDraft: {
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
  },
});

export async function getPublicSynthesisReview(
  slug: string,
  client: PrismaClient = prisma,
  requestedVersionId?: string,
): Promise<PublicSynthesisReview | null> {
  const review = await client.review.findUnique({
    where: { slug },
    include: {
      currentSynthesisVersion: { include: publicSynthesisVersionInclude },
      versions: {
        where: { id: requestedVersionId ?? "__current-synthesis-only__" },
        take: 1,
        include: publicSynthesisVersionInclude,
      },
    },
  });
  if (!review) return null;
  const version = requestedVersionId ? review.versions[0] : review.currentSynthesisVersion;
  const isCurrent = review.currentSynthesisVersionId === version?.id;
  if (
    review.reviewType !== "ai-synthesis" ||
    review.status !== "published" ||
    review.repositoryId ||
    review.currentSnapshotId ||
    review.synthesisSeriesKey !== version?.synthesisDraft?.seriesKey ||
    (!requestedVersionId && !isCurrent) ||
    (requestedVersionId && version?.id !== requestedVersionId) ||
    !version ||
    version.reviewId !== review.id ||
    version.recordSourceType !== "synthesis" ||
    version.snapshotId ||
    version.isExample !== false ||
    version.publicState !== "published" ||
    !version.synthesisDraft ||
    version.synthesisDraft.status !== "accepted" ||
    version.synthesisDraft.reviewId !== review.id ||
    version.synthesisDraft.reviewVersion?.id !== version.id ||
    version.synthesisDraft.reviewVersion?.synthesisOrdinal !== version.synthesisOrdinal
  )
    return null;

  const draft = version.synthesisDraft as LoadedDraft;
  let integrity: ReturnType<typeof assertDraftIntegrity>;
  let checklistIsValid = false;
  try {
    integrity = assertDraftIntegrity(draft);
    checklistIsValid =
      draft.checklistVersion !== null &&
      draft.checklistJson !== null &&
      isSupportedSynthesisAcceptanceChecklist(
        draft.checklistVersion,
        JSON.parse(draft.checklistJson),
      );
  } catch {
    return null;
  }
  const predecessor = version.acceptedPredecessor;
  const ordinal = version.synthesisOrdinal;
  const editorAttribution = version.synthesisAttributions.find(
    (entry) => entry.kind === "approving-editor",
  );
  const softwareAttribution = version.synthesisAttributions.find(
    (entry) => entry.kind === "software-agent",
  );
  if (
    !ordinal ||
    version.synthesisDocumentJson !== draft.documentJson ||
    version.synthesisDraftId !== draft.id ||
    version.sourceSelectionKey !== `${draft.seriesKey}:${ordinal}` ||
    version.title !== integrity.document.title ||
    version.abstract !== integrity.document.summary ||
    version.synthesisDocumentHash !== draft.documentHash ||
    version.synthesisPacketHash !== draft.packetHash ||
    version.synthesisPromptHash !== draft.promptHash ||
    version.synthesisPromptVersion !== draft.promptVersion ||
    version.synthesisGenerationMode !== draft.generationMode ||
    version.synthesisPipelineId !== draft.pipelineSoftwareId ||
    version.synthesisPipelineKind !== draft.pipelineSoftwareKind ||
    version.synthesisPipelineName !== draft.pipelineSoftwareName ||
    version.synthesisPipelineVersion !== draft.pipelineSoftwareVersion ||
    version.synthesisProvider !== draft.provider ||
    version.synthesisModel !== draft.model ||
    version.synthesisModelVersion !== draft.modelVersion ||
    version.synthesisAttributionPolicyVersion !== draft.attributionPolicyVersion ||
    version.synthesisMaterializationPolicyVersion !== draft.materializationPolicyVersion ||
    !checklistIsValid ||
    version.synthesisChecklistVersion !== draft.checklistVersion ||
    version.synthesisRightsStatement !== draft.rightsStatement ||
    version.synthesisLicenseSpdx !== draft.licenseSpdx ||
    version.versionDoi !== draft.versionDoi ||
    version.conceptDoi !== draft.conceptDoi ||
    version.synthesisGeneratedAt?.getTime() !== draft.generatedAt.getTime() ||
    !version.synthesisAcceptedAt ||
    !version.synthesisApproverRole ||
    !version.synthesisApproverDisplayName ||
    !version.synthesisApproverGithubLogin ||
    !version.synthesisRightsStatement ||
    !version.synthesisLicenseSpdx ||
    draft.acceptedAt?.getTime() !== version.synthesisAcceptedAt.getTime() ||
    draft.acceptedByRoleSnapshot !== version.synthesisApproverRole ||
    draft.acceptedByDisplayName !== version.synthesisApproverDisplayName ||
    draft.acceptedByGithubLogin !== version.synthesisApproverGithubLogin ||
    draft.agentRun.humanReviewStatus !== "approved" ||
    version.synthesisApprovedById === null ||
    version.synthesisApprovedById !== draft.acceptedById ||
    (version.synthesisApproverRole !== "EDITOR" && version.synthesisApproverRole !== "ADMIN") ||
    (ordinal === 1 ? predecessor !== null : !predecessor) ||
    (predecessor &&
      (predecessor.reviewId !== review.id ||
        predecessor.recordSourceType !== "synthesis" ||
        predecessor.synthesisOrdinal !== ordinal - 1 ||
        predecessor.synthesisDraftId !== draft.previousAcceptedDraftId ||
        predecessor.synthesisOrdinal !== draft.previousAcceptedOrdinal)) ||
    (!predecessor &&
      (draft.previousAcceptedDraftId !== null || draft.previousAcceptedOrdinal !== null)) ||
    version.synthesisAttributions.length !== 2 ||
    !softwareAttribution ||
    softwareAttribution.position !== 0 ||
    softwareAttribution.kind !== "software-agent" ||
    softwareAttribution.role !== "synthesis-generation" ||
    softwareAttribution.userId !== null ||
    softwareAttribution.userRoleSnapshot !== null ||
    softwareAttribution.githubLoginSnapshot !== null ||
    softwareAttribution.displayName !== version.synthesisPipelineName ||
    softwareAttribution.softwareVersion !== version.synthesisPipelineVersion ||
    !editorAttribution ||
    editorAttribution.position !== 1 ||
    editorAttribution.kind !== "approving-editor" ||
    editorAttribution.role !== "editorial-approval" ||
    editorAttribution.softwareVersion !== null ||
    editorAttribution.userId !== version.synthesisApprovedById ||
    editorAttribution.userId !== draft.acceptedById ||
    editorAttribution.displayName !== version.synthesisApproverDisplayName ||
    editorAttribution.userRoleSnapshot !== version.synthesisApproverRole ||
    editorAttribution.githubLoginSnapshot !== version.synthesisApproverGithubLogin
  )
    return null;

  const candidate = publicSynthesisReviewSchema.safeParse({
    slug: review.slug,
    reviewType: "ai-synthesis",
    title: integrity.document.title,
    abstract: integrity.document.summary,
    document: integrity.document,
    provenance: {
      generationMode: version.synthesisGenerationMode,
      pipelineSoftware: {
        id: version.synthesisPipelineId,
        kind: version.synthesisPipelineKind,
        displayName: version.synthesisPipelineName,
        pipelineVersion: version.synthesisPipelineVersion,
      },
      provider: version.synthesisProvider,
      model: version.synthesisModel,
      modelVersion: version.synthesisModelVersion,
      promptVersion: version.synthesisPromptVersion,
      promptHash: version.synthesisPromptHash,
      packetHash: version.synthesisPacketHash,
      documentHash: version.synthesisDocumentHash,
      generatedAt: version.synthesisGeneratedAt?.toISOString(),
      acceptedAt: version.synthesisAcceptedAt.toISOString(),
      approvingEditor: {
        displayName: version.synthesisApproverDisplayName,
        githubLogin: version.synthesisApproverGithubLogin,
        roleSnapshot: version.synthesisApproverRole,
      },
      attributionPolicyVersion: version.synthesisAttributionPolicyVersion,
      checklistVersion: version.synthesisChecklistVersion,
      materializationPolicyVersion: version.synthesisMaterializationPolicyVersion,
      rightsStatement: version.synthesisRightsStatement,
      licenseSpdx: version.synthesisLicenseSpdx,
      ordinal,
      acceptedPredecessorVersionId: predecessor?.id ?? null,
      acceptedPredecessorOrdinal: predecessor?.synthesisOrdinal ?? null,
    },
    citations: draftCitationDtos(draft).map((citation) => ({
      ...citation,
      href: `/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`,
    })),
    version: {
      id: version.id,
      ordinal,
      isCurrent,
      versionDoi: version.versionDoi ?? undefined,
      conceptDoi: version.conceptDoi ?? undefined,
    },
    freshness: (() => {
      const observation = version.synthesisStalenessHead;
      const unchecked = {
        status: "unchecked" as const,
        policyVersion: SYNTHESIS_STALENESS_POLICY_VERSION,
        reasonCodes: [],
        affectedReferenceCount: 0,
      };
      if (
        !observation ||
        observation.reviewId !== review.id ||
        observation.acceptedReviewVersionId !== version.id ||
        observation.currentEvaluationId !== observation.currentEvaluation.id
      )
        return unchecked;
      const validated = validateStoredSynthesisStaleness(
        observation.currentEvaluation,
        {
          reviewId: review.id,
          acceptedReviewVersionId: version.id,
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
      return validated?.freshness ?? unchecked;
    })(),
  });
  return candidate.success ? candidate.data : null;
}

/** Load one immutable accepted synthesis version without falling back to the current head. */
export function getPublicSynthesisReviewVersion(
  slug: string,
  versionId: string,
  client: PrismaClient = prisma,
) {
  return getPublicSynthesisReview(slug, client, versionId);
}
