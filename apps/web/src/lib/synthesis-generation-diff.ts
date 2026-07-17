import "server-only";
import type { PrismaClient } from "@oratlas/db";
import { canonicalJson, synthesisReviewDocumentSchema } from "@oratlas/contracts";
import {
  compareSynthesisGenerations,
  type SynthesisGenerationDelta,
  type SynthesisGenerationSnapshot,
} from "@oratlas/knowledge";
import { prisma } from "./db";
import { getPublicSynthesisReview } from "./synthesis-editorial";

const VERSION_ID = /^[A-Za-z0-9_-]{1,200}$/;

export interface PublicSynthesisGenerationVersion {
  id: string;
  ordinal: number;
  acceptedAt: string;
  packetHash: string;
  documentHash: string;
}

export interface PublicSynthesisGenerationDiff {
  slug: string;
  title: string;
  from: PublicSynthesisGenerationVersion;
  to: PublicSynthesisGenerationVersion;
  delta: SynthesisGenerationDelta;
}

export interface SynthesisGenerationDiffSelection {
  fromVersionId?: unknown;
  toVersionId?: unknown;
}

async function loadVersion(client: PrismaClient, id: string) {
  return client.reviewVersion.findUnique({
    where: { id },
    include: {
      acceptedPredecessor: {
        select: {
          id: true,
          reviewId: true,
          recordSourceType: true,
          publicState: true,
          synthesisOrdinal: true,
          synthesisDraftId: true,
        },
      },
      synthesisDraft: {
        include: {
          reviewVersion: { select: { id: true, synthesisOrdinal: true } },
        },
      },
    },
  });
}

type LoadedVersion = NonNullable<Awaited<ReturnType<typeof loadVersion>>>;
type LoadedReview = NonNullable<Awaited<ReturnType<typeof loadReview>>>;

async function loadReview(client: PrismaClient, slug: string) {
  return client.review.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      reviewType: true,
      repositoryId: true,
      currentSnapshotId: true,
      synthesisSeriesKey: true,
      currentSynthesisVersionId: true,
    },
  });
}

function requestedVersionId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && VERSION_ID.test(value) ? value : null;
}

function parseSnapshot(
  row: LoadedVersion,
  review: LoadedReview,
): SynthesisGenerationSnapshot | null {
  const draft = row.synthesisDraft;
  if (
    row.reviewId !== review.id ||
    row.recordSourceType !== "synthesis" ||
    row.snapshotId !== null ||
    row.isExample !== false ||
    row.publicState !== "published" ||
    !row.synthesisOrdinal ||
    !row.synthesisDraftId ||
    !row.synthesisDocumentJson ||
    !row.synthesisPacketHash ||
    !row.synthesisDocumentHash ||
    !row.synthesisAcceptedAt ||
    !row.synthesisApprovedById ||
    (row.synthesisApproverRole !== "EDITOR" && row.synthesisApproverRole !== "ADMIN") ||
    !row.synthesisApproverDisplayName ||
    !row.synthesisApproverGithubLogin ||
    !draft ||
    draft.id !== row.synthesisDraftId ||
    draft.status !== "accepted" ||
    draft.reviewId !== review.id ||
    draft.seriesKey !== review.synthesisSeriesKey ||
    draft.reviewVersion?.id !== row.id ||
    draft.reviewVersion?.synthesisOrdinal !== row.synthesisOrdinal ||
    draft.reviewVersion === null ||
    row.sourceSelectionKey !== `${draft.seriesKey}:${row.synthesisOrdinal}` ||
    row.synthesisDocumentJson !== draft.documentJson ||
    row.synthesisPacketHash !== draft.packetHash ||
    row.synthesisDocumentHash !== draft.documentHash ||
    draft.acceptedAt?.getTime() !== row.synthesisAcceptedAt.getTime() ||
    draft.acceptedById !== row.synthesisApprovedById ||
    draft.acceptedByRoleSnapshot !== row.synthesisApproverRole ||
    draft.acceptedByDisplayName !== row.synthesisApproverDisplayName ||
    draft.acceptedByGithubLogin !== row.synthesisApproverGithubLogin
  )
    return null;

  let packet: unknown;
  let document: unknown;
  try {
    packet = JSON.parse(draft.packetJson) as unknown;
    document = JSON.parse(draft.documentJson) as unknown;
  } catch {
    return null;
  }
  const parsedDocument = synthesisReviewDocumentSchema.safeParse(document);
  if (
    !parsedDocument.success ||
    canonicalJson(parsedDocument.data) !== draft.documentJson ||
    row.title !== parsedDocument.data.title ||
    row.abstract !== parsedDocument.data.summary
  )
    return null;
  return {
    packet: packet as SynthesisGenerationSnapshot["packet"],
    packetJson: draft.packetJson,
    packetHash: draft.packetHash,
    document: parsedDocument.data,
    documentJson: draft.documentJson,
    documentHash: draft.documentHash,
  };
}

function versionMetadata(row: LoadedVersion): PublicSynthesisGenerationVersion {
  return {
    id: row.id,
    ordinal: row.synthesisOrdinal!,
    acceptedAt: row.synthesisAcceptedAt!.toISOString(),
    packetHash: row.synthesisPacketHash!,
    documentHash: row.synthesisDocumentHash!,
  };
}

/**
 * Resolve a public, direct accepted-generation comparison. Any publication, chain, binding, or
 * canonical-integrity ambiguity fails closed without returning private draft or agent fields.
 */
export async function getPublicSynthesisGenerationDiff(
  slug: string,
  selection: SynthesisGenerationDiffSelection = {},
  client: PrismaClient = prisma,
): Promise<PublicSynthesisGenerationDiff | null> {
  const requestedFrom = requestedVersionId(selection.fromVersionId);
  const requestedTo = requestedVersionId(selection.toVersionId);
  if (requestedFrom === null || requestedTo === null) return null;

  try {
    const [review, publicCurrent] = await Promise.all([
      loadReview(client, slug),
      getPublicSynthesisReview(slug, client),
    ]);
    if (
      !review ||
      !publicCurrent ||
      review.status !== "published" ||
      review.reviewType !== "ai-synthesis" ||
      review.repositoryId !== null ||
      review.currentSnapshotId !== null ||
      !review.synthesisSeriesKey ||
      !review.currentSynthesisVersionId ||
      publicCurrent.version.id !== review.currentSynthesisVersionId
    )
      return null;

    const toId = requestedTo ?? review.currentSynthesisVersionId;
    const to = await loadVersion(client, toId);
    if (
      !to ||
      to.reviewId !== review.id ||
      !to.acceptedPredecessorVersionId ||
      !to.synthesisOrdinal ||
      to.synthesisOrdinal > publicCurrent.version.ordinal
    )
      return null;
    const fromId = requestedFrom ?? to.acceptedPredecessorVersionId;
    if (fromId === toId || to.acceptedPredecessorVersionId !== fromId) return null;
    const from = await loadVersion(client, fromId);
    if (!from || from.reviewId !== review.id) return null;

    const fromDraft = from.synthesisDraft;
    const toDraft = to.synthesisDraft;
    if (
      !fromDraft ||
      !toDraft ||
      from.synthesisOrdinal === null ||
      to.synthesisOrdinal !== from.synthesisOrdinal + 1 ||
      to.acceptedPredecessor?.id !== from.id ||
      to.acceptedPredecessor.reviewId !== review.id ||
      to.acceptedPredecessor.recordSourceType !== "synthesis" ||
      to.acceptedPredecessor.publicState !== "published" ||
      to.acceptedPredecessor.synthesisOrdinal !== from.synthesisOrdinal ||
      to.acceptedPredecessor.synthesisDraftId !== fromDraft.id ||
      toDraft.previousAcceptedDraftId !== fromDraft.id ||
      toDraft.previousAcceptedOrdinal !== from.synthesisOrdinal ||
      fromDraft.seriesKey !== toDraft.seriesKey ||
      fromDraft.seriesKey !== review.synthesisSeriesKey ||
      (from.synthesisOrdinal === 1
        ? from.acceptedPredecessorVersionId !== null ||
          fromDraft.previousAcceptedDraftId !== null ||
          fromDraft.previousAcceptedOrdinal !== null
        : !from.acceptedPredecessorVersionId ||
          !from.acceptedPredecessor ||
          from.acceptedPredecessor.reviewId !== review.id ||
          from.acceptedPredecessor.recordSourceType !== "synthesis" ||
          from.acceptedPredecessor.publicState !== "published" ||
          from.acceptedPredecessor.synthesisOrdinal !== from.synthesisOrdinal - 1 ||
          from.acceptedPredecessor.synthesisDraftId !== fromDraft.previousAcceptedDraftId ||
          fromDraft.previousAcceptedOrdinal !== from.synthesisOrdinal - 1)
    )
      return null;

    const previous = parseSnapshot(from, review);
    const current = parseSnapshot(to, review);
    if (!previous || !current) return null;
    const delta = compareSynthesisGenerations(previous, current);
    return {
      slug: review.slug,
      title: publicCurrent.title,
      from: versionMetadata(from),
      to: versionMetadata(to),
      delta,
    };
  } catch {
    return null;
  }
}
