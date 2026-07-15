import "server-only";
import {
  canonicalJson,
  canonicalWorkAliases,
  citationStatusInputSchema,
  claimDomAnchor,
  globalClaimId,
  proposalResolutionSchema,
  type CitationStatusInput,
  type ProposalResolution,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { withSqliteRetry as sharedWithSqliteRetry } from "./db-retry";
import { isReadablePublicState } from "./review-lifecycle";
import {
  listExecutionPassportsForClaim,
  type PublicExecutionPassport,
} from "./execution-passports";
import { getPublicProtocolSummary, type ProtocolDriftSummary } from "./protocol-drift";

/**
 * Evidence monitoring and claim passports (issue #3). A registered signal
 * about a cited work deterministically identifies affected claims through
 * canonical work aliases and opens one human-reviewable update proposal per
 * claim. Conclusions are never rewritten automatically; every resolution is
 * an attributable editorial act.
 */

export class MonitoringError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "MonitoringError";
  }
}

export interface Actor {
  id: string;
  role: string;
}

function isEditorRole(role: string): boolean {
  return role === "EDITOR" || role === "ADMIN";
}

function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  return sharedWithSqliteRetry(operation, (error) => error instanceof MonitoringError);
}

export interface RegisterStatusResult {
  statusRecordId: string;
  workAlias: string;
  proposalsOpened: number;
  affectedClaimIds: string[];
}

/**
 * Register an externally observed change to a cited work and open update
 * proposals for every claim whose evidence cites that work. Matching is
 * deterministic over canonical work aliases; no model decides impact.
 */
export async function registerCitationStatus(
  actor: Actor,
  input: CitationStatusInput,
): Promise<RegisterStatusResult> {
  if (!isEditorRole(actor.role)) {
    throw new MonitoringError("Editor role required to register status signals.", "forbidden");
  }
  const parsed = citationStatusInputSchema.parse(input);
  const aliases = canonicalWorkAliases({
    doi: parsed.doi,
    pmid: parsed.pmid,
    openAlexId: parsed.openAlexId,
  });
  if (aliases.length === 0) {
    throw new MonitoringError("No canonical work identifier could be derived from the input.");
  }
  const aliasSet = new Set<string>(aliases);

  // POC scale: alias comparison happens in application code over the cited
  // works. Issue #7 moves this behind an indexed alias table.
  const citations = await prisma.citation.findMany({
    where: { OR: [{ doi: { not: null } }, { pmid: { not: null } }, { openAlexId: { not: null } }] },
    select: {
      id: true,
      doi: true,
      pmid: true,
      openAlexId: true,
      title: true,
      reviewVersionId: true,
      evidenceRelations: { select: { claimId: true, relationType: true } },
    },
  });
  const affected = citations.filter((citation) =>
    canonicalWorkAliases({
      doi: citation.doi ?? undefined,
      pmid: citation.pmid ?? undefined,
      openAlexId: citation.openAlexId ?? undefined,
    }).some((alias) => aliasSet.has(alias)),
  );

  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const record = await tx.citationStatusRecord.create({
          data: {
            workAlias: aliases[0]!,
            status: parsed.status,
            source: parsed.source,
            evidenceUrl: parsed.evidenceUrl,
            note: parsed.note,
            recordedById: actor.id,
          },
        });
        // One proposal per claim and signal: dedupe in application code so no
        // unique violation ever fires inside the transaction (a caught P2002
        // would abort the whole transaction on Postgres).
        const targetByClaim = new Map<string, { citationId: string; relationType: string }>();
        for (const citation of affected) {
          for (const relation of citation.evidenceRelations) {
            if (!targetByClaim.has(relation.claimId)) {
              targetByClaim.set(relation.claimId, {
                citationId: citation.id,
                relationType: relation.relationType,
              });
            }
          }
        }
        const affectedClaimIds = [...targetByClaim.keys()];
        for (const [claimId, target] of targetByClaim) {
          await tx.claimUpdateProposal.create({
            data: {
              statusRecordId: record.id,
              claimId,
              citationId: target.citationId,
              rationale:
                `Cited work ${aliases[0]} was marked "${parsed.status}" (source: ${parsed.source}). ` +
                `This claim relies on it via a "${target.relationType}" relation.`,
            },
          });
        }
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "monitoring.status-registered",
            subjectType: "citation-status",
            subjectId: record.id,
            detailsJson: canonicalJson({
              workAlias: aliases[0],
              status: parsed.status,
              proposalsOpened: affectedClaimIds.length,
            }),
          },
        });
        const editors = await tx.user.findMany({
          where: { role: { in: ["EDITOR", "ADMIN"] } },
          select: { id: true },
        });
        for (const editor of editors) {
          await tx.notification.create({
            data: {
              userId: editor.id,
              kind: "evidence-alert",
              subjectType: "citation-status",
              subjectId: record.id,
              payloadJson: canonicalJson({
                kind: "citation-status",
                status: parsed.status,
                proposalsOpened: affectedClaimIds.length,
              }),
            },
          });
        }
        return {
          statusRecordId: record.id,
          workAlias: aliases[0]!,
          proposalsOpened: affectedClaimIds.length,
          affectedClaimIds,
        };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

/** Resolve an open proposal with an attributable editorial note. */
export async function resolveProposal(
  actor: Actor,
  proposalId: string,
  resolution: ProposalResolution,
): Promise<void> {
  if (!isEditorRole(actor.role)) {
    throw new MonitoringError("Editor role required to resolve proposals.", "forbidden");
  }
  const parsed = proposalResolutionSchema.parse(resolution);
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const changed = await tx.claimUpdateProposal.updateMany({
          where: { id: proposalId, status: "open" },
          data: {
            status: parsed.resolution,
            resolvedById: actor.id,
            resolutionNote: parsed.note,
            resolvedAt: new Date(),
          },
        });
        if (changed.count !== 1) {
          throw new MonitoringError("Proposal not found or already resolved.", "conflict");
        }
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "monitoring.proposal-resolved",
            subjectType: "claim-update-proposal",
            subjectId: proposalId,
            detailsJson: canonicalJson({ resolution: parsed.resolution }),
          },
        });
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

export interface ProposalRow {
  id: string;
  status: string;
  rationale: string;
  citationStatus: string;
  workAlias: string;
  source: string;
  evidenceUrl?: string;
  claimLocalId: string;
  claimText: string;
  reviewSlug?: string;
  reviewVersionId: string;
  passportPath: string;
  createdAt: string;
  resolvedByLogin?: string;
  resolutionNote?: string;
  resolvedAt?: string;
}

type ProposalWithContext = Prisma.ClaimUpdateProposalGetPayload<{
  include: {
    statusRecord: true;
    resolvedBy: true;
    claim: { include: { reviewVersion: { include: { review: true } } } };
  };
}>;

function proposalDto(proposal: ProposalWithContext): ProposalRow {
  const version = proposal.claim.reviewVersion;
  return {
    id: proposal.id,
    status: proposal.status,
    rationale: proposal.rationale,
    citationStatus: proposal.statusRecord.status,
    workAlias: proposal.statusRecord.workAlias,
    source: proposal.statusRecord.source,
    evidenceUrl: proposal.statusRecord.evidenceUrl ?? undefined,
    claimLocalId: proposal.claim.localClaimId,
    claimText: proposal.claim.text,
    reviewSlug: version.review.slug,
    reviewVersionId: version.id,
    passportPath: `/claims/${version.id}/${encodeURIComponent(proposal.claim.localClaimId)}`,
    createdAt: proposal.createdAt.toISOString(),
    resolvedByLogin: proposal.resolvedBy?.githubLogin,
    resolutionNote: proposal.resolutionNote ?? undefined,
    resolvedAt: proposal.resolvedAt?.toISOString(),
  };
}

const PROPOSAL_INCLUDE = {
  statusRecord: true,
  resolvedBy: true,
  claim: { include: { reviewVersion: { include: { review: true } } } },
} as const;

/** Open proposals for the editorial queue. */
export async function listOpenProposals(): Promise<ProposalRow[]> {
  const rows = await prisma.claimUpdateProposal.findMany({
    where: {
      status: "open",
      claim: { reviewVersion: { publicState: { in: ["published", "withdrawn"] } } },
    },
    include: PROPOSAL_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(proposalDto);
}

/**
 * Public update-proposal feed for one review (living-review CI surface): an
 * upstream repository can gate CI on `openCount === 0`.
 */
export async function listProposalsForSlug(
  slug: string,
): Promise<{ openCount: number; proposals: ProposalRow[] } | null> {
  // Public boundary: only published reviews, and only claims of readable
  // (non-tombstoned) versions, matching the passport and review pages.
  const review = await prisma.review.findFirst({
    where: { slug, status: "published" },
    select: { id: true },
  });
  if (!review) return null;
  const rows = await prisma.claimUpdateProposal.findMany({
    where: {
      claim: {
        reviewVersion: { reviewId: review.id, publicState: { in: ["published", "withdrawn"] } },
      },
    },
    include: PROPOSAL_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const proposals = rows.map(proposalDto);
  return {
    openCount: proposals.filter((proposal) => proposal.status === "open").length,
    proposals,
  };
}

/** Open-alert counts by repository-local claim id, for version-page badges. */
export async function getClaimAlertCounts(reviewVersionId: string): Promise<Map<string, number>> {
  const rows = await prisma.claimUpdateProposal.findMany({
    where: { status: "open", claim: { reviewVersionId } },
    select: { claim: { select: { localClaimId: true } } },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.claim.localClaimId, (counts.get(row.claim.localClaimId) ?? 0) + 1);
  }
  return counts;
}

export interface ClaimPassport {
  claimId: string;
  localClaimId: string;
  anchor: string;
  text: string;
  section?: string;
  claimType?: string;
  qualification?: string;
  reviewSlug: string;
  reviewTitle: string;
  versionId: string;
  semanticVersion?: string;
  publishedAt?: string;
  isExample: boolean;
  evidence: Array<{
    relationType: string;
    supportDirection?: string;
    /** Exact selector into the source artifacts, when the repository provided one. */
    sourceLocation?: string;
    citationLocalId: string;
    citationTitle?: string;
    citationDoi?: string;
    citationIsExample: boolean;
    hasTrustAssessment: boolean;
  }>;
  lineage: Array<{
    versionId: string;
    semanticVersion?: string;
    publishedAt?: string;
    isCurrent: boolean;
    isThisVersion: boolean;
    textChanged: boolean;
  }>;
  alerts: ProposalRow[];
  executionPassports: PublicExecutionPassport[];
  protocolDrift: ProtocolDriftSummary;
}

/**
 * Stable public passport for one claim of one immutable version. Lineage is
 * deterministic: the same repository-local claim id across the review's
 * versions, with text changes surfaced, never inferred.
 */
export async function getClaimPassport(
  versionId: string,
  localClaimId: string,
): Promise<ClaimPassport | null> {
  const claim = await prisma.claim.findFirst({
    where: { reviewVersionId: versionId, localClaimId },
    include: {
      reviewVersion: { include: { review: { include: { versions: true } } } },
      evidenceRelations: {
        include: { citation: true, trustAssessments: { select: { id: true } } },
      },
      updateProposals: { include: PROPOSAL_INCLUDE },
    },
  });
  if (!claim) return null;
  const version = claim.reviewVersion;
  const review = version.review;
  if (review.status !== "published" || !isReadablePublicState(version.publicState)) {
    return null;
  }

  const currentVersionId = [...review.versions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]?.id;
  const lineageVersions = review.versions
    .filter((candidate) => isReadablePublicState(candidate.publicState))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lineageClaims = await prisma.claim.findMany({
    where: { localClaimId, reviewVersionId: { in: lineageVersions.map((entry) => entry.id) } },
    select: { reviewVersionId: true, normalizedText: true },
  });
  const textByVersion = new Map(
    lineageClaims.map((entry) => [entry.reviewVersionId, entry.normalizedText]),
  );
  const executionPassports = await listExecutionPassportsForClaim(versionId, localClaimId);

  const protocolDrift = await getPublicProtocolSummary(version.id, claim.localClaimId);
  if (!protocolDrift) return null;

  return {
    claimId: globalClaimId(version.id, claim.localClaimId),
    localClaimId: claim.localClaimId,
    anchor: claimDomAnchor(version.id, claim.localClaimId),
    text: claim.text,
    section: claim.section ?? undefined,
    claimType: claim.claimType ?? undefined,
    qualification: claim.qualification ?? undefined,
    reviewSlug: review.slug,
    reviewTitle: version.title,
    versionId: version.id,
    semanticVersion: version.semanticVersion ?? undefined,
    publishedAt: version.publishedAt?.toISOString(),
    isExample: version.isExample,
    evidence: claim.evidenceRelations.map((relation) => ({
      relationType: relation.relationType,
      supportDirection: relation.supportDirection ?? undefined,
      sourceLocation: relation.sourceLocation ?? undefined,
      citationLocalId: relation.citation.localCitationId,
      citationTitle: relation.citation.title ?? undefined,
      citationDoi: relation.citation.doi ?? undefined,
      citationIsExample: isExampleCitation(relation.citation.rawCitationJson),
      hasTrustAssessment: relation.trustAssessments.length > 0,
    })),
    lineage: lineageVersions
      .filter((candidate) => textByVersion.has(candidate.id))
      .map((candidate) => ({
        versionId: candidate.id,
        semanticVersion: candidate.semanticVersion ?? undefined,
        publishedAt: candidate.publishedAt?.toISOString(),
        isCurrent: candidate.id === currentVersionId,
        isThisVersion: candidate.id === version.id,
        textChanged: textByVersion.get(candidate.id) !== claim.normalizedText,
      })),
    alerts: claim.updateProposals.map(proposalDto),
    executionPassports,
    protocolDrift,
  };
}

function isExampleCitation(rawJson: string | null): boolean {
  if (!rawJson) return false;
  try {
    return (JSON.parse(rawJson) as { isExample?: boolean })?.isExample === true;
  } catch {
    return false;
  }
}
