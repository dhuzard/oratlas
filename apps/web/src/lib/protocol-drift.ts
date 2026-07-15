import "server-only";
import { createHash } from "node:crypto";
import { canonicalJson, claimScopeSchema } from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import {
  adaptClinicalTrialsGovStudy,
  adaptOsfRegistration,
  compareProtocolToReview,
  normalizedProtocolSchema,
  protocolProposalResolutionSchema,
  protocolSnapshotInputSchema,
  type NormalizedProtocol,
  type ObservedReview,
  type ProtocolCategory,
  type ProtocolEvidence,
  type ProtocolProposalResolution,
  type ProtocolSnapshotInput,
} from "@oratlas/protocols";
import { prisma } from "./db";
import { prismaCode, withSqliteRetry } from "./db-retry";
import { isReadablePublicState } from "./review-lifecycle";

/** Protocol comparisons are neutral metadata proposals; no automated finding asserts intent. */
export class ProtocolDriftError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "ProtocolDriftError";
  }
}

export interface ProtocolActor {
  id: string;
  role: string;
}

function requireEditor(actor: ProtocolActor): void {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new ProtocolDriftError("Editor role required for protocol reconciliation.", "forbidden");
  }
}

export interface RegisterProtocolResult {
  snapshotId: string;
  sourceId: string;
  proposalsOpened: number;
  idempotent: boolean;
  publicPath: string;
}

/**
 * Persist an exact external snapshot, derive observed fields only from declared
 * claim scope, and open stable neutral proposals. No free-text/intent inference
 * and no network access occur in this workflow.
 */
export async function registerProtocolSnapshot(
  actor: ProtocolActor,
  input: ProtocolSnapshotInput,
): Promise<RegisterProtocolResult> {
  requireEditor(actor);
  const parsed = protocolSnapshotInputSchema.parse(input);
  const rawJson = canonicalJson(parsed.payload);
  const questionMetadataJson = parsed.osfQuestions ? canonicalJson(parsed.osfQuestions) : undefined;
  const contentHash = sha256(
    canonicalJson({ payload: parsed.payload, osfQuestions: parsed.osfQuestions ?? null }),
  );
  const protocol = normalizeInput(parsed);
  if (!sourceUrlIdentifies(parsed.registry, parsed.sourceUrl, protocol.source.sourceId)) {
    throw new ProtocolDriftError(
      "Registry URL does not identify the source id declared by the registry payload.",
    );
  }
  const target = await loadObservedTarget(parsed.reviewVersionId, parsed.claimLocalId);
  const targetKey = target.observed.targetKey;
  const snapshotId = `ps_${sha256(
    canonicalJson({
      targetKey,
      registry: protocol.source.registry,
      sourceId: protocol.source.sourceId,
      sourceVersion: protocol.source.sourceVersion,
      contentHash,
    }),
  )}`;

  const versionCollision = await prisma.protocolSnapshot.findFirst({
    where: {
      targetKey,
      registry: protocol.source.registry,
      sourceId: protocol.source.sourceId,
      sourceVersion: protocol.source.sourceVersion,
    },
    select: { id: true, contentHash: true },
  });
  if (versionCollision && versionCollision.contentHash !== contentHash) {
    throw new ProtocolDriftError(
      "The same upstream source version was already captured with different content.",
      "conflict",
    );
  }
  if (versionCollision) {
    return {
      snapshotId: versionCollision.id,
      sourceId: protocol.source.sourceId,
      proposalsOpened: 0,
      idempotent: true,
      publicPath: publicPath(parsed.reviewVersionId, parsed.claimLocalId),
    };
  }

  const proposals = compareProtocolToReview(protocol, target.observed);
  try {
    return await withSqliteRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const existing = await tx.protocolSnapshot.findUnique({ where: { id: snapshotId } });
            if (existing) {
              return {
                snapshotId: existing.id,
                sourceId: protocol.source.sourceId,
                proposalsOpened: 0,
                idempotent: true,
                publicPath: publicPath(parsed.reviewVersionId, parsed.claimLocalId),
              };
            }
            await tx.protocolSnapshot.create({
              data: {
                id: snapshotId,
                reviewVersionId: parsed.reviewVersionId,
                claimId: target.claimId,
                createdById: actor.id,
                targetKey,
                registry: protocol.source.registry,
                sourceId: protocol.source.sourceId,
                sourceUrl: protocol.source.sourceUrl,
                sourceVersion: protocol.source.sourceVersion,
                sourceTimestamp: protocol.source.lastUpdatedAt
                  ? new Date(protocol.source.lastUpdatedAt)
                  : protocol.source.registeredAt
                    ? new Date(protocol.source.registeredAt)
                    : undefined,
                fetchedAt: new Date(protocol.source.capturedAt),
                normalizedJson: canonicalJson(protocol),
                rawJson,
                questionMetadataJson,
                contentHash,
                observedJson: canonicalJson(target.observed),
                comparatorVersion: proposals[0]?.comparatorVersion ?? "1.0.0",
              },
            });
            for (const proposal of proposals) {
              await tx.protocolDriftProposal.create({
                data: {
                  id: proposal.id,
                  snapshotId,
                  category: proposal.category,
                  kind: proposal.kind,
                  registeredJson: canonicalJson(proposal.registered),
                  observedJson: canonicalJson(proposal.observed),
                  rationale: proposal.rationale,
                  comparatorVersion: proposal.comparatorVersion,
                },
              });
            }
            await tx.auditEvent.create({
              data: {
                actorId: actor.id,
                action: "protocol.snapshot-registered",
                subjectType: "protocol-snapshot",
                subjectId: snapshotId,
                idempotencyKey: `protocol.snapshot-registered:${snapshotId}`,
                detailsJson: canonicalJson({
                  targetKey,
                  registry: protocol.source.registry,
                  sourceId: protocol.source.sourceId,
                  sourceVersion: protocol.source.sourceVersion,
                  contentHash,
                  proposalsOpened: proposals.length,
                }),
              },
            });
            return {
              snapshotId,
              sourceId: protocol.source.sourceId,
              proposalsOpened: proposals.length,
              idempotent: false,
              publicPath: publicPath(parsed.reviewVersionId, parsed.claimLocalId),
            };
          },
          { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
        ),
      (error) => error instanceof ProtocolDriftError,
    );
  } catch (error) {
    // Concurrent captures race safely against the provider-portable unique key.
    // Resolve exact retries idempotently, but reject a reused mutable version.
    if (prismaCode(error) === "P2002") {
      const concurrent = await prisma.protocolSnapshot.findFirst({
        where: {
          targetKey,
          registry: protocol.source.registry,
          sourceId: protocol.source.sourceId,
          sourceVersion: protocol.source.sourceVersion,
        },
        select: { id: true, contentHash: true },
      });
      if (concurrent?.contentHash === contentHash) {
        return {
          snapshotId: concurrent.id,
          sourceId: protocol.source.sourceId,
          proposalsOpened: 0,
          idempotent: true,
          publicPath: publicPath(parsed.reviewVersionId, parsed.claimLocalId),
        };
      }
      if (concurrent) {
        throw new ProtocolDriftError(
          "The same upstream source version was captured concurrently with different content.",
          "conflict",
        );
      }
    }
    throw error;
  }
}

export async function resolveProtocolProposal(
  actor: ProtocolActor,
  proposalId: string,
  resolution: ProtocolProposalResolution,
): Promise<void> {
  requireEditor(actor);
  const parsed = protocolProposalResolutionSchema.parse(resolution);
  return withSqliteRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          const changed = await tx.protocolDriftProposal.updateMany({
            where: { id: proposalId, status: "open" },
            data: {
              status: parsed.resolution,
              resolvedById: actor.id,
              resolutionNote: parsed.note,
              resolvedAt: new Date(),
            },
          });
          if (changed.count !== 1) {
            const existing = await tx.protocolDriftProposal.findUnique({
              where: { id: proposalId },
              select: { id: true },
            });
            throw new ProtocolDriftError(
              existing ? "Proposal is no longer open." : "Proposal not found.",
              existing ? "conflict" : "not-found",
            );
          }
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "protocol.proposal-resolved",
              subjectType: "protocol-drift-proposal",
              subjectId: proposalId,
              detailsJson: canonicalJson({ resolution: parsed.resolution }),
            },
          });
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      ),
    (error) => error instanceof ProtocolDriftError,
  );
}

export interface ProtocolProposalRow {
  id: string;
  category: ProtocolCategory;
  kind: string;
  status: string;
  rationale: string;
  registered: ProtocolEvidence[];
  observed: ProtocolEvidence[];
  createdAt: string;
  resolvedAt?: string;
  resolvedByLogin?: string;
  resolutionNote?: string;
}

export interface ProtocolSnapshotSummary {
  id: string;
  target: "review-version" | "claim";
  registry: string;
  sourceId: string;
  sourceUrl: string;
  sourceVersion: string;
  sourceTimestamp?: string;
  fetchedAt: string;
  contentHash: string;
  normalized: NormalizedProtocol;
  proposals: ProtocolProposalRow[];
  createdAt: string;
}

export interface ProtocolDriftSummary {
  reviewVersionId: string;
  claimLocalId?: string;
  openCount: number;
  snapshots: ProtocolSnapshotSummary[];
}

const SNAPSHOT_INCLUDE = {
  claim: { select: { localClaimId: true } },
  proposals: { include: { resolvedBy: true }, orderBy: { createdAt: "asc" as const } },
} as const;

type SnapshotWithProposals = Prisma.ProtocolSnapshotGetPayload<{
  include: typeof SNAPSHOT_INCLUDE;
}>;

export async function getPublicProtocolSummary(
  reviewVersionId: string,
  claimLocalId?: string,
): Promise<ProtocolDriftSummary | null> {
  const version = await prisma.reviewVersion.findFirst({
    where: {
      id: reviewVersionId,
      review: { status: "published" },
    },
    select: { id: true, publicState: true },
  });
  if (!version || !isReadablePublicState(version.publicState)) return null;
  let claimId: string | undefined;
  if (claimLocalId) {
    claimId = (
      await prisma.claim.findUnique({
        where: { reviewVersionId_localClaimId: { reviewVersionId, localClaimId: claimLocalId } },
        select: { id: true },
      })
    )?.id;
    if (!claimId) return null;
  }
  const snapshots = await prisma.protocolSnapshot.findMany({
    where: claimId ? { claimId } : { reviewVersionId, claimId: null },
    include: SNAPSHOT_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const rows = snapshots.map(snapshotDto);
  return {
    reviewVersionId,
    claimLocalId,
    openCount: rows.flatMap((row) => row.proposals).filter((row) => row.status === "open").length,
    snapshots: rows,
  };
}

export async function listOpenProtocolProposals(): Promise<
  Array<ProtocolProposalRow & { sourceId: string; publicPath: string }>
> {
  const rows = await prisma.protocolDriftProposal.findMany({
    where: {
      status: "open",
      snapshot: {
        reviewVersion: {
          review: { status: "published" },
          publicState: { in: ["published", "withdrawn"] },
        },
      },
    },
    include: {
      resolvedBy: true,
      snapshot: { include: { claim: { select: { localClaimId: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((row) => ({
    ...proposalDto(row),
    sourceId: row.snapshot.sourceId,
    publicPath: publicPath(row.snapshot.reviewVersionId, row.snapshot.claim?.localClaimId),
  }));
}

function normalizeInput(input: ProtocolSnapshotInput): NormalizedProtocol {
  const capture = {
    sourceUrl: input.sourceUrl,
    sourceVersion: input.sourceVersion,
    fetchedAt: input.fetchedAt,
  };
  return input.registry === "osf"
    ? adaptOsfRegistration(input.payload, input.osfQuestions ?? [], capture)
    : adaptClinicalTrialsGovStudy(input.payload, capture);
}

async function loadObservedTarget(
  reviewVersionId: string,
  claimLocalId?: string,
): Promise<{ observed: ObservedReview; claimId?: string }> {
  const version = await prisma.reviewVersion.findUnique({
    where: { id: reviewVersionId },
    include: { claims: true },
  });
  if (!version) throw new ProtocolDriftError("Review version not found.", "not-found");
  const claims = claimLocalId
    ? version.claims.filter((claim) => claim.localClaimId === claimLocalId)
    : version.claims;
  if (claimLocalId && claims.length !== 1) {
    throw new ProtocolDriftError("Claim not found in the requested review version.", "not-found");
  }
  const fields: ObservedReview["fields"] = {
    population: [],
    outcomes: [],
    exclusions: [],
    "analysis-plan": [],
  };
  for (const claim of claims) {
    if (claim.scopeJson === null) continue;
    let rawScope: unknown;
    try {
      rawScope = JSON.parse(claim.scopeJson) as unknown;
    } catch {
      throw new ProtocolDriftError(
        `Stored scope for claim '${claim.localClaimId}' is malformed.`,
        "conflict",
      );
    }
    const scope = claimScopeSchema.safeParse(rawScope);
    if (!scope.success) {
      throw new ProtocolDriftError(
        `Stored scope for claim '${claim.localClaimId}' violates the claim scope contract.`,
        "conflict",
      );
    }
    addObserved(fields.population, scope.data.population, claim.localClaimId, "population");
    addObserved(fields.outcomes, scope.data.outcome, claim.localClaimId, "outcome");
    addObserved(fields.exclusions, scope.data.exclusions, claim.localClaimId, "exclusions");
    addObserved(
      fields["analysis-plan"],
      scope.data.analysisPlan ?? scope.data.method,
      claim.localClaimId,
      scope.data.analysisPlan ? "analysisPlan" : "method",
    );
  }
  const claimId = claims.length === 1 && claimLocalId ? claims[0]!.id : undefined;
  const targetKey = claimId ? `claim:${claimId}` : `review-version:${reviewVersionId}`;
  return {
    claimId,
    observed: { reviewVersionId, targetKey, fields },
  };
}

function addObserved(
  target: ProtocolEvidence[],
  value: string | undefined,
  localClaimId: string,
  field: string,
): void {
  if (value) target.push({ value, sourcePointer: `claim:${localClaimId}/scope/${field}` });
}

function snapshotDto(snapshot: SnapshotWithProposals): ProtocolSnapshotSummary {
  return {
    id: snapshot.id,
    target: snapshot.claimId ? "claim" : "review-version",
    registry: snapshot.registry,
    sourceId: snapshot.sourceId,
    sourceUrl: snapshot.sourceUrl,
    sourceVersion: snapshot.sourceVersion,
    sourceTimestamp: snapshot.sourceTimestamp?.toISOString(),
    fetchedAt: snapshot.fetchedAt.toISOString(),
    contentHash: snapshot.contentHash,
    normalized: normalizedProtocolSchema.parse(JSON.parse(snapshot.normalizedJson)),
    proposals: snapshot.proposals.map(proposalDto),
    createdAt: snapshot.createdAt.toISOString(),
  };
}

function proposalDto(row: {
  id: string;
  category: string;
  kind: string;
  status: string;
  rationale: string;
  registeredJson: string;
  observedJson: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: { githubLogin: string } | null;
  resolutionNote: string | null;
}): ProtocolProposalRow {
  return {
    id: row.id,
    category: row.category as ProtocolCategory,
    kind: row.kind,
    status: row.status,
    rationale: row.rationale,
    registered: JSON.parse(row.registeredJson) as ProtocolEvidence[],
    observed: JSON.parse(row.observedJson) as ProtocolEvidence[],
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
    resolvedByLogin: row.resolvedBy?.githubLogin,
    resolutionNote: row.resolutionNote ?? undefined,
  };
}

function publicPath(reviewVersionId: string, claimLocalId?: string): string {
  return claimLocalId
    ? `/claims/${reviewVersionId}/${encodeURIComponent(claimLocalId)}`
    : `/api/protocols/reviews/${reviewVersionId}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceUrlIdentifies(
  registry: "osf" | "clinicaltrials-gov",
  sourceUrl: string,
  sourceId: string,
): boolean {
  try {
    const url = new URL(sourceUrl);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const expected = sourceId.toLowerCase();
    if (registry === "clinicaltrials-gov") {
      return Boolean(
        ((segments.length === 2 && segments[0]?.toLowerCase() === "study") ||
          (segments.length === 4 &&
            segments[0]?.toLowerCase() === "api" &&
            segments[1]?.toLowerCase() === "v2" &&
            segments[2]?.toLowerCase() === "studies")) &&
        segments.at(-1)?.toLowerCase() === expected,
      );
    }
    return Boolean(
      ((url.hostname.toLowerCase() === "osf.io" && segments.length === 1) ||
        (url.hostname.toLowerCase() === "api.osf.io" &&
          segments.length === 3 &&
          segments[0]?.toLowerCase() === "v2" &&
          segments[1]?.toLowerCase() === "registrations")) &&
      segments.at(-1)?.toLowerCase() === expected,
    );
  } catch {
    return false;
  }
}
