import "server-only";
import {
  canonicalJson,
  globalClaimId,
  replicationBriefCreateSchema,
  replicationBriefStatusSchema,
  replicationBriefTransitionSchema,
  replicationEffortBandSchema,
  replicationMarketplaceQuerySchema,
  replicationPublicUrlSchema,
  replicationScopeSchema,
  replicationTriageBandSchema,
  type ReplicationBriefCreate,
  type ReplicationBriefStatus,
  type ReplicationBriefTransition,
  type ReplicationMarketplaceQuery,
  type ReplicationScope,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { prismaCode, withSqliteRetry } from "./db-retry";
import { sha256 } from "./hash";
import { getReplicationCorpusHash, getReplicationTriageForClaimIds } from "./synthesis";

const PUBLIC_STATUSES = ["open", "claimed", "completed", "withdrawn"] as const;
const READABLE_VERSION_STATES = ["published", "withdrawn"] as const;

export class ReplicationMarketplaceError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "ReplicationMarketplaceError";
  }
}

export interface ReplicationActor {
  id: string;
  role: string;
}

function isEditor(actor: ReplicationActor): boolean {
  return actor.role === "EDITOR" || actor.role === "ADMIN";
}

function retry<T>(operation: () => Promise<T>): Promise<T> {
  return withSqliteRetry(operation, (error) => error instanceof ReplicationMarketplaceError);
}

const BRIEF_INCLUDE = {
  createdBy: { select: { githubLogin: true } },
  publishedBy: { select: { githubLogin: true } },
  claimedBy: { select: { githubLogin: true } },
  completedBy: { select: { githubLogin: true } },
  withdrawnBy: { select: { githubLogin: true } },
  claims: {
    orderBy: { position: "asc" as const },
    include: {
      claim: {
        include: { reviewVersion: { include: { review: { select: { slug: true } } } } },
      },
    },
  },
} as const;

type BriefWithContext = Prisma.ReplicationBriefGetPayload<{ include: typeof BRIEF_INCLUDE }>;

export interface ReplicationBriefView {
  slug: string;
  title: string;
  summary: string;
  scope: ReplicationScope;
  expectedInformationGain: string;
  effortBand: string;
  protocolUrl?: string;
  citationUrls: string[];
  status: ReplicationBriefStatus;
  revision: number;
  triageSnapshot?: unknown;
  claims: Array<{
    reviewSlug: string;
    reviewVersionId: string;
    localClaimId: string;
    text: string;
    passportPath: string;
  }>;
  createdByLogin: string;
  publishedByLogin?: string;
  publishedAt?: string;
  claimedByLogin?: string;
  claimedAt?: string;
  claimNote?: string;
  completedByLogin?: string;
  completedAt?: string;
  completionUrl?: string;
  completionSummary?: string;
  withdrawnByLogin?: string;
  withdrawnAt?: string;
  withdrawalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedReplicationTriageRow {
  claimId: string;
  triageBand: string;
  signals: Array<{ code: string; explanation: string }>;
  text: string;
  passportPath: string;
  capturedAt: string;
  sourceBriefSlug: string;
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function briefView(brief: BriefWithContext): ReplicationBriefView {
  const status = replicationBriefStatusSchema.parse(brief.status);
  const effortBand = replicationEffortBandSchema.parse(brief.effortBand);
  const scope = replicationScopeSchema.parse(parseJson(brief.scopeJson, null));
  const citationUrls = replicationPublicUrlSchema
    .array()
    .min(1)
    .max(20)
    .parse(parseJson(brief.citationUrlsJson, []));
  const protocolUrl = brief.protocolUrl
    ? replicationPublicUrlSchema.parse(brief.protocolUrl)
    : undefined;
  return {
    slug: brief.slug,
    title: brief.title,
    summary: brief.summary,
    scope,
    expectedInformationGain: brief.expectedInformationGain,
    effortBand,
    protocolUrl,
    citationUrls,
    status,
    revision: brief.revision,
    triageSnapshot: brief.triageSnapshotJson
      ? parseJson(brief.triageSnapshotJson, undefined)
      : undefined,
    claims: brief.claims.map(({ claim }) => ({
      reviewSlug: claim.reviewVersion.review.slug,
      reviewVersionId: claim.reviewVersionId,
      localClaimId: claim.localClaimId,
      text: claim.text,
      passportPath: `/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`,
    })),
    createdByLogin: brief.createdBy.githubLogin,
    publishedByLogin: brief.publishedBy?.githubLogin,
    publishedAt: brief.publishedAt?.toISOString(),
    claimedByLogin: brief.claimedBy?.githubLogin,
    claimedAt: brief.claimedAt?.toISOString(),
    claimNote: brief.claimNote ?? undefined,
    completedByLogin: brief.completedBy?.githubLogin,
    completedAt: brief.completedAt?.toISOString(),
    completionUrl: brief.completionUrl ?? undefined,
    completionSummary: brief.completionSummary ?? undefined,
    withdrawnByLogin: brief.withdrawnBy?.githubLogin,
    withdrawnAt: brief.withdrawnAt?.toISOString(),
    withdrawalReason: brief.withdrawalReason ?? undefined,
    createdAt: brief.createdAt.toISOString(),
    updatedAt: brief.updatedAt.toISOString(),
  };
}

const publicClaimsWhere: Prisma.ReplicationBriefClaimListRelationFilter = {
  some: {},
  every: {
    claim: {
      is: {
        reviewVersion: {
          is: {
            publicState: { in: [...READABLE_VERSION_STATES] },
            review: { is: { status: "published" } },
          },
        },
      },
    },
  },
};

export async function listPublicReplicationBriefs(
  query: ReplicationMarketplaceQuery,
): Promise<{ page: number; pageSize: number; total: number; briefs: ReplicationBriefView[] }> {
  const parsed = replicationMarketplaceQuerySchema.parse(query);
  const where: Prisma.ReplicationBriefWhereInput = {
    publishedAt: { not: null },
    status: parsed.status ?? { in: [...PUBLIC_STATUSES] },
    effortBand: parsed.effortBand,
    claims: publicClaimsWhere,
  };
  const [total, rows] = await Promise.all([
    prisma.replicationBrief.count({ where }),
    prisma.replicationBrief.findMany({
      where,
      include: BRIEF_INCLUDE,
      orderBy: [{ publishedAt: "desc" }, { slug: "asc" }],
      skip: (parsed.page - 1) * parsed.pageSize,
      take: parsed.pageSize,
    }),
  ]);
  return { page: parsed.page, pageSize: parsed.pageSize, total, briefs: rows.map(briefView) };
}

/**
 * Public triage is provenance already frozen by a human publication action.
 * It never runs corpus synthesis on an anonymous request and scans at most the
 * bounded marketplace page supplied by the caller.
 */
export function publishedReplicationTriage(
  briefs: readonly ReplicationBriefView[],
  limit = 30,
): PublishedReplicationTriageRow[] {
  const boundedLimit = Math.max(1, Math.min(30, Math.trunc(limit)));
  const rows: PublishedReplicationTriageRow[] = [];
  const seen = new Set<string>();
  for (const brief of briefs.slice(0, 50)) {
    const snapshot = asRecord(brief.triageSnapshot);
    if (!snapshot || typeof snapshot.capturedAt !== "string" || !Array.isArray(snapshot.claims)) {
      continue;
    }
    const linkedClaims = new Map(
      brief.claims.map((claim) => [
        globalClaimId(claim.reviewVersionId, claim.localClaimId),
        claim,
      ]),
    );
    for (const candidate of snapshot.claims.slice(0, 20)) {
      const claim = asRecord(candidate);
      if (!claim || typeof claim.claimId !== "string" || seen.has(claim.claimId)) continue;
      const triageBand = replicationTriageBandSchema.safeParse(claim.triageBand);
      const linked = linkedClaims.get(claim.claimId);
      const signals = publicTriageSignals(claim.signals);
      if (!triageBand.success || !linked || !signals) continue;
      seen.add(claim.claimId);
      rows.push({
        claimId: claim.claimId,
        triageBand: triageBand.data,
        signals,
        text: linked.text,
        passportPath: linked.passportPath,
        capturedAt: snapshot.capturedAt,
        sourceBriefSlug: brief.slug,
      });
      if (rows.length === boundedLimit) return rows;
    }
  }
  return rows;
}

export async function loadPublicReplicationMarketplace(
  status?: "open" | "claimed" | "completed" | "withdrawn",
): Promise<{
  marketplace: Awaited<ReturnType<typeof listPublicReplicationBriefs>>;
  triage: PublishedReplicationTriageRow[];
}> {
  const marketplace = await listPublicReplicationBriefs({ status, page: 1, pageSize: 50 });
  return { marketplace, triage: publishedReplicationTriage(marketplace.briefs, 30) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function publicTriageSignals(
  value: unknown,
): Array<{ code: string; explanation: string }> | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const signals: Array<{ code: string; explanation: string }> = [];
  for (const entry of value) {
    const signal = asRecord(entry);
    if (
      !signal ||
      typeof signal.code !== "string" ||
      signal.code.length > 80 ||
      typeof signal.explanation !== "string" ||
      signal.explanation.length > 1_000
    ) {
      return undefined;
    }
    signals.push({ code: signal.code, explanation: signal.explanation });
  }
  return signals;
}

export async function getPublicReplicationBrief(
  slug: string,
): Promise<ReplicationBriefView | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
  const row = await prisma.replicationBrief.findFirst({
    where: {
      slug,
      publishedAt: { not: null },
      status: { in: [...PUBLIC_STATUSES] },
      claims: publicClaimsWhere,
    },
    include: BRIEF_INCLUDE,
  });
  return row ? briefView(row) : null;
}

/** Server-only identity check; internal user ids are never included in the public DTO. */
export async function isReplicationBriefClaimant(slug: string, actorId: string): Promise<boolean> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100 || !actorId) return false;
  return Boolean(
    await prisma.replicationBrief.findFirst({
      where: {
        slug,
        status: "claimed",
        publishedAt: { not: null },
        claimedById: actorId,
        claims: publicClaimsWhere,
      },
      select: { id: true },
    }),
  );
}

export async function listEditorialReplicationBriefs(): Promise<ReplicationBriefView[]> {
  const rows = await prisma.replicationBrief.findMany({
    include: BRIEF_INCLUDE,
    orderBy: [{ updatedAt: "desc" }, { slug: "asc" }],
    take: 200,
  });
  return rows.map(briefView);
}

export async function createReplicationBriefDraft(
  actor: ReplicationActor,
  input: ReplicationBriefCreate,
): Promise<{
  slug: string;
  status: ReplicationBriefStatus;
  revision: number;
  idempotent: boolean;
}> {
  if (!isEditor(actor)) {
    throw new ReplicationMarketplaceError("Editor role required to register a brief.", "forbidden");
  }
  const parsed = replicationBriefCreateSchema.parse(input);
  const payloadForHash = { ...parsed, idempotencyKey: undefined };
  const requestHash = sha256(canonicalJson(payloadForHash));
  const claimRows = await prisma.claim.findMany({
    where: {
      OR: parsed.claims.map((claim) => ({
        reviewVersionId: claim.reviewVersionId,
        localClaimId: claim.localClaimId,
      })),
      reviewVersion: {
        publicState: { in: [...READABLE_VERSION_STATES] },
        review: { status: "published" },
      },
    },
    select: { id: true, reviewVersionId: true, localClaimId: true },
  });
  const byRef = new Map(
    claimRows.map((claim) => [`${claim.reviewVersionId}\u0000${claim.localClaimId}`, claim.id]),
  );
  const orderedClaimIds = parsed.claims.map(
    (claim) => byRef.get(`${claim.reviewVersionId}\u0000${claim.localClaimId}`) ?? "",
  );
  if (orderedClaimIds.some((id) => !id)) {
    throw new ReplicationMarketplaceError(
      "Every claim must belong to a readable published review version.",
      "bad-request",
    );
  }

  try {
    return await retry(() =>
      prisma.$transaction(
        async (tx) => {
          const created = await tx.replicationBrief.create({
            data: {
              requestKey: parsed.idempotencyKey,
              requestHash,
              slug: parsed.slug,
              title: parsed.title,
              summary: parsed.summary,
              scopeJson: canonicalJson(parsed.scope),
              expectedInformationGain: parsed.expectedInformationGain,
              effortBand: parsed.effortBand,
              protocolUrl: parsed.protocolUrl,
              citationUrlsJson: canonicalJson(parsed.citationUrls),
              createdById: actor.id,
              claims: {
                create: orderedClaimIds.map((claimId, position) => ({ claimId, position })),
              },
            },
          });
          await writeAudit(tx, actor.id, "replication.brief-drafted", created.id, {
            slug: created.slug,
            claimCount: orderedClaimIds.length,
            status: "draft",
          });
          return { slug: created.slug, status: "draft" as const, revision: 0, idempotent: false };
        },
        { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
      ),
    );
  } catch (error) {
    if (prismaCode(error) !== "P2002") throw error;
    const existing = await prisma.replicationBrief.findUnique({
      where: { requestKey: parsed.idempotencyKey },
    });
    if (existing && existing.createdById === actor.id && existing.requestHash === requestHash) {
      return {
        slug: existing.slug,
        status: replicationBriefStatusSchema.parse(existing.status),
        revision: existing.revision,
        idempotent: true,
      };
    }
    if (existing) {
      throw new ReplicationMarketplaceError(
        "The idempotency key was already used for different draft content.",
        "conflict",
      );
    }
    throw new ReplicationMarketplaceError("A brief with this slug already exists.", "conflict");
  }
}

export async function transitionReplicationBrief(
  actor: ReplicationActor,
  slug: string,
  transition: ReplicationBriefTransition,
): Promise<{ slug: string; status: ReplicationBriefStatus; revision: number }> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) {
    throw new ReplicationMarketplaceError("Invalid replication brief slug.", "bad-request");
  }
  const parsed = replicationBriefTransitionSchema.parse(transition);
  let triageSnapshot: string | undefined;
  let triageCorpusHash: string | undefined;
  let triageCapturedAt: string | undefined;
  if (parsed.action === "withdraw" && !isEditor(actor)) {
    throw new ReplicationMarketplaceError("Editor role required to withdraw.", "forbidden");
  }
  if (parsed.action === "publish") {
    if (!isEditor(actor)) {
      throw new ReplicationMarketplaceError(
        "Editor role required to publish a brief.",
        "forbidden",
      );
    }
    const draft = await prisma.replicationBrief.findUnique({
      where: { slug },
      select: {
        status: true,
        revision: true,
        claims: {
          orderBy: { position: "asc" },
          select: { claim: { select: { reviewVersionId: true, localClaimId: true } } },
        },
      },
    });
    if (!draft) throw new ReplicationMarketplaceError("Replication brief not found.", "not-found");
    if (draft.status !== "draft" || draft.revision !== parsed.expectedRevision) {
      throw new ReplicationMarketplaceError(
        "Only the current draft revision can be published.",
        "conflict",
      );
    }
    const claimIds = draft.claims.map(({ claim }) =>
      globalClaimId(claim.reviewVersionId, claim.localClaimId),
    );
    const snapshot = await getReplicationTriageForClaimIds(claimIds);
    if (snapshot.rows.length !== claimIds.length) {
      throw new ReplicationMarketplaceError(
        "A linked claim is no longer in the readable synthesis corpus.",
        "conflict",
      );
    }
    triageCorpusHash = snapshot.corpusHash;
    triageCapturedAt = snapshot.capturedAt;
    triageSnapshot = canonicalJson({
      schemaVersion: "1.0.0",
      corpusHash: snapshot.corpusHash,
      capturedAt: snapshot.capturedAt,
      method: snapshot.rows[0]?.method,
      disclaimer: snapshot.rows[0]?.disclaimer,
      claims: snapshot.rows.map((entry) => ({
        claimId: entry.claimId,
        triageBand: entry.triageBand,
        signals: entry.signals,
        independence: entry.independence,
        contradictions: entry.contradictions,
      })),
    });
  }

  return retry(() =>
    prisma.$transaction(
      async (tx) => {
        const publicActionWhere: Prisma.ReplicationBriefWhereInput | undefined =
          parsed.action === "claim"
            ? {
                slug,
                publishedAt: { not: null },
                claims: publicClaimsWhere,
              }
            : parsed.action === "complete"
              ? {
                  slug,
                  publishedAt: { not: null },
                  claimedById: actor.id,
                  claims: publicClaimsWhere,
                }
              : undefined;
        const brief = publicActionWhere
          ? await tx.replicationBrief.findFirst({ where: publicActionWhere })
          : await tx.replicationBrief.findUnique({ where: { slug } });
        if (!brief) {
          throw new ReplicationMarketplaceError("Replication brief not found.", "not-found");
        }
        if (brief.revision !== parsed.expectedRevision) {
          throw new ReplicationMarketplaceError(
            "Replication brief changed; refresh before retrying.",
            "conflict",
          );
        }
        const now = new Date();
        let nextStatus: ReplicationBriefStatus;
        let data: Prisma.ReplicationBriefUncheckedUpdateManyInput;
        let auditDetails: Record<string, unknown>;

        if (parsed.action === "publish") {
          if (!isEditor(actor)) {
            throw new ReplicationMarketplaceError("Editor role required to publish.", "forbidden");
          }
          if (brief.status !== "draft") {
            throw new ReplicationMarketplaceError(
              "Only a draft brief can be published.",
              "conflict",
            );
          }
          const [claimCount, readableClaimCount] = await Promise.all([
            tx.replicationBriefClaim.count({ where: { replicationBriefId: brief.id } }),
            tx.replicationBriefClaim.count({
              where: {
                replicationBriefId: brief.id,
                claim: {
                  is: {
                    reviewVersion: {
                      is: {
                        publicState: { in: [...READABLE_VERSION_STATES] },
                        review: { is: { status: "published" } },
                      },
                    },
                  },
                },
              },
            }),
          ]);
          if (claimCount < 1 || readableClaimCount !== claimCount) {
            throw new ReplicationMarketplaceError(
              "Every linked claim must remain publicly readable at publication.",
              "conflict",
            );
          }
          if (!triageCorpusHash || (await getReplicationCorpusHash(tx)) !== triageCorpusHash) {
            throw new ReplicationMarketplaceError(
              "The readable evidence corpus changed; refresh the triage snapshot before publishing.",
              "conflict",
            );
          }
          nextStatus = "open";
          data = {
            status: nextStatus,
            revision: { increment: 1 },
            publishedById: actor.id,
            publishedAt: now,
            triageSnapshotJson: triageSnapshot,
          };
          auditDetails = {
            from: "draft",
            to: nextStatus,
            methodology: "deterministic-editorial-triage-not-truth-scoring",
            corpusHash: triageCorpusHash,
            capturedAt: triageCapturedAt,
          };
        } else if (parsed.action === "claim") {
          if (brief.status !== "open") {
            throw new ReplicationMarketplaceError("Only an open brief can be claimed.", "conflict");
          }
          nextStatus = "claimed";
          data = {
            status: nextStatus,
            revision: { increment: 1 },
            claimedById: actor.id,
            claimedAt: now,
            claimNote: parsed.note,
            protocolUrl: parsed.protocolUrl,
          };
          auditDetails = { from: "open", to: nextStatus, protocolUrl: parsed.protocolUrl };
        } else if (parsed.action === "complete") {
          if (brief.status !== "claimed" || brief.claimedById !== actor.id) {
            throw new ReplicationMarketplaceError("Replication brief not found.", "not-found");
          }
          nextStatus = "completed";
          data = {
            status: nextStatus,
            revision: { increment: 1 },
            completedById: actor.id,
            completedAt: now,
            completionUrl: parsed.completionUrl,
            completionSummary: parsed.summary,
          };
          auditDetails = { from: "claimed", to: nextStatus, completionUrl: parsed.completionUrl };
        } else {
          if (!isEditor(actor)) {
            throw new ReplicationMarketplaceError("Editor role required to withdraw.", "forbidden");
          }
          if (!new Set(["draft", "open", "claimed"]).has(brief.status)) {
            throw new ReplicationMarketplaceError(
              "Only a draft, open, or claimed brief can be withdrawn.",
              "conflict",
            );
          }
          nextStatus = "withdrawn";
          data = {
            status: nextStatus,
            revision: { increment: 1 },
            withdrawnById: actor.id,
            withdrawnAt: now,
            withdrawalReason: parsed.reason,
          };
          auditDetails = { from: brief.status, to: nextStatus, reason: parsed.reason };
        }

        const changed = await tx.replicationBrief.updateMany({
          where: {
            id: brief.id,
            status: brief.status,
            revision: parsed.expectedRevision,
            ...(publicActionWhere ?? {}),
          },
          data,
        });
        if (changed.count !== 1) {
          throw new ReplicationMarketplaceError(
            "Replication brief changed concurrently; refresh before retrying.",
            "conflict",
          );
        }
        await writeAudit(
          tx,
          actor.id,
          `replication.brief-${parsed.action === "publish" ? "published" : parsed.action === "claim" ? "claimed" : parsed.action === "complete" ? "completed" : "withdrawn"}`,
          brief.id,
          auditDetails,
        );
        return { slug, status: nextStatus, revision: parsed.expectedRevision + 1 };
      },
      { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
    ),
  );
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  subjectId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId,
      action,
      subjectType: "replication-brief",
      subjectId,
      detailsJson: canonicalJson(details),
    },
  });
}
