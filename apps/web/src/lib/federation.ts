import "server-only";
import { canonicalJson } from "@oratlas/contracts";
import {
  buildAnnounceReview,
  federationResolutionSchema,
  parseCoarNotifyActivity,
  type FederationResolution,
  type RequestReviewActivity,
} from "@oratlas/federation";
import { prisma } from "./db";
import { prismaCode, withSqliteRetry } from "./db-retry";
import { getServerEnv } from "./auth";
import { sha256 } from "./hash";

export class FederationError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "FederationError";
  }
}

function baseUrl(): string {
  return getServerEnv().NEXT_PUBLIC_BASE_URL.replace(/\/$/, "");
}

function expectedInbox(): string {
  return `${baseUrl()}/api/federation/inbox`;
}

export interface FederationReceipt {
  id: string;
  activityId: string;
  pattern: string;
  status: string;
  deduplicated: boolean;
}

/**
 * Persist a size-limited, already-buffered COAR Notify payload. URLs are
 * identifiers only: the inbox never dereferences untrusted actor/object URLs.
 */
export async function receiveFederationNotification(input: unknown): Promise<FederationReceipt> {
  const activity = parseCoarNotifyActivity(input);
  if (activity.targetInbox.replace(/\/$/, "") !== expectedInbox()) {
    throw new FederationError("Notification target inbox does not identify this ORAtlas service.");
  }
  const payloadJson = canonicalJson(activity.payload);
  const payloadHash = sha256(payloadJson);

  try {
    return await withSqliteRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const existing = await tx.federationNotification.findUnique({
            where: { activityId: activity.activityId },
          });
          if (existing) {
            if (existing.payloadHash !== payloadHash) {
              throw new FederationError(
                "Activity id was already received with different immutable content.",
                "conflict",
              );
            }
            return {
              id: existing.id,
              activityId: existing.activityId,
              pattern: existing.pattern,
              status: existing.status,
              deduplicated: true,
            };
          }

          const stored = await tx.federationNotification.create({
            data: {
              activityId: activity.activityId,
              direction: "inbound",
              pattern: activity.pattern,
              actorUri: activity.actorId,
              objectUri: activity.objectId,
              contextUri: activity.contextId,
              originUri: activity.originId,
              originInbox: activity.originInbox,
              targetUri: activity.targetId,
              targetInbox: activity.targetInbox,
              inReplyTo: activity.inReplyTo,
              payloadJson,
              payloadHash,
            },
          });
          await tx.auditEvent.create({
            data: {
              action: "federation.notification-received",
              subjectType: "federation-notification",
              subjectId: stored.id,
              idempotencyKey: `federation.receive:${activity.activityId}`,
              detailsJson: canonicalJson({
                activityId: activity.activityId,
                actorUri: activity.actorId,
                originUri: activity.originId,
                pattern: activity.pattern,
                payloadHash,
              }),
            },
          });
          return {
            id: stored.id,
            activityId: stored.activityId,
            pattern: stored.pattern,
            status: stored.status,
            deduplicated: false,
          };
        }),
      (error) => error instanceof FederationError,
    );
  } catch (error) {
    if (prismaCode(error) !== "P2002") throw error;
    const winner = await prisma.federationNotification.findUnique({
      where: { activityId: activity.activityId },
    });
    if (!winner || winner.payloadHash !== payloadHash) {
      throw new FederationError(
        "Activity id was received concurrently with different immutable content.",
        "conflict",
      );
    }
    return {
      id: winner.id,
      activityId: winner.activityId,
      pattern: winner.pattern,
      status: winner.status,
      deduplicated: true,
    };
  }
}

export interface FederationQueueItem {
  id: string;
  activityId: string;
  pattern: string;
  actorUri?: string;
  objectUri: string;
  contextUri?: string;
  originUri: string;
  status: string;
  createdAt: string;
}

export async function listFederationQueue(): Promise<FederationQueueItem[]> {
  const rows = await prisma.federationNotification.findMany({
    where: { direction: "inbound" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    activityId: row.activityId,
    pattern: row.pattern,
    actorUri: row.actorUri ?? undefined,
    objectUri: row.objectUri,
    contextUri: row.contextUri ?? undefined,
    originUri: row.originUri,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface FederationInboxPage {
  document: {
    "@context": string;
    "@id": string;
    contains: string[];
  };
  nextUrl?: string;
}

/** List only editor-accepted notifications with a stable, bounded cursor. */
export async function listFederationInbox(
  options: { cursor?: string; limit?: number } = {},
): Promise<FederationInboxPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  if (options.cursor) {
    const cursor = await prisma.federationNotification.findFirst({
      where: { id: options.cursor, direction: "inbound", status: "accepted" },
      select: { id: true },
    });
    if (!cursor) throw new FederationError("Federation inbox cursor is invalid.");
  }
  const rows = await prisma.federationNotification.findMany({
    where: { direction: "inbound", status: "accepted" },
    select: { id: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const base = baseUrl();
  const pageRows = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? pageRows.at(-1)?.id : undefined;
  let nextUrl: string | undefined;
  if (nextCursor) {
    const next = new URL(expectedInbox());
    next.searchParams.set("cursor", nextCursor);
    next.searchParams.set("limit", String(limit));
    nextUrl = next.toString();
  }
  return {
    document: {
      "@context": "http://www.w3.org/ns/ldp",
      "@id": expectedInbox(),
      contains: pageRows.map(
        (row) => `${base}/api/federation/notifications/${encodeURIComponent(row.id)}`,
      ),
    },
    ...(nextUrl ? { nextUrl } : {}),
  };
}

export async function getFederationNotificationPayload(id: string): Promise<unknown | null> {
  const row = await prisma.federationNotification.findFirst({
    where: { id, direction: "inbound", status: "accepted" },
    select: { payloadJson: true },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.payloadJson) as unknown;
  } catch {
    return null;
  }
}

export async function resolveFederationNotification(
  actor: { id: string; role: string },
  id: string,
  input: FederationResolution,
): Promise<{ id: string; status: string }> {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new FederationError("Editor role required.", "forbidden");
  }
  const resolution = federationResolutionSchema.parse(input);
  return withSqliteRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const changed = await tx.federationNotification.updateMany({
          where: { id, direction: "inbound", status: "pending" },
          data: {
            status: resolution.decision,
            resolutionNote: resolution.note,
            resolvedById: actor.id,
            resolvedAt: new Date(),
          },
        });
        if (changed.count !== 1) {
          const exists = await tx.federationNotification.findUnique({ where: { id } });
          throw new FederationError(
            exists ? "Notification is no longer pending." : "Notification not found.",
            exists ? "conflict" : "not-found",
          );
        }
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "federation.notification-resolved",
            subjectType: "federation-notification",
            subjectId: id,
            idempotencyKey: `federation.resolve:${id}`,
            detailsJson: canonicalJson(resolution),
          },
        });
        return { id, status: resolution.decision };
      }),
    (error) => error instanceof FederationError,
  );
}

function deterministicActivityUrn(identity: unknown): string {
  const hash = sha256(canonicalJson(identity));
  return `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Prepare and audit an Announce Review reply to one accepted inbound request.
 * No delivery or external fetch occurs on this path.
 */
export async function prepareVersionReviewAnnouncement(
  actor: { id: string; role: string },
  slug: string,
  versionId: string,
  inReplyTo: string,
): Promise<unknown> {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new FederationError("Editor role required.", "forbidden");
  }
  const request = await prisma.federationNotification.findFirst({
    where: {
      activityId: inReplyTo,
      direction: "inbound",
      pattern: "request-review",
      status: "accepted",
    },
  });
  if (!request) {
    throw new FederationError("Accepted Request Review notification not found.", "not-found");
  }
  if (!request.originInbox) {
    throw new FederationError("Request origin did not provide an inbox for the reply.");
  }
  const parsedRequest = parseCoarNotifyActivity(JSON.parse(request.payloadJson));
  if (parsedRequest.pattern !== "request-review") {
    throw new FederationError("Stored Request Review payload is invalid.", "conflict");
  }
  const requestPayload = parsedRequest.payload as RequestReviewActivity;
  const version = await prisma.reviewVersion.findFirst({
    where: {
      id: versionId,
      review: { slug, status: "published" },
      publicState: { in: ["published", "withdrawn"] },
    },
    include: { review: true },
  });
  if (!version) throw new FederationError("Readable review version not found.", "not-found");
  const base = baseUrl();
  const versionUrl = `${base}/reviews/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}`;
  const target = { id: request.originUri, inbox: request.originInbox };
  const activityId = deterministicActivityUrn({
    versionId: version.id,
    reviewedResource: request.objectUri,
    target,
    inReplyTo,
  });
  const payload = buildAnnounceReview({
    activityId,
    actor: { id: `${base}/system`, name: "Open Review Atlas" },
    review: {
      id: versionUrl,
      ...(version.versionDoi && !version.isExample
        ? { citeAs: `https://doi.org/${version.versionDoi}` }
        : {}),
      item: {
        id: `${base}/api/reviews/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}/export/json`,
        type: "Document",
        mediaType: "application/vnd.oratlas.scholarly+json",
      },
      exports: [
        {
          id: `${base}/api/reviews/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}/export/ro-crate`,
          type: "Document",
          mediaType: "application/ld+json",
        },
      ],
    },
    reviewedResource: {
      id: requestPayload.object.id,
      ...(requestPayload.object["ietf:cite-as"]
        ? { citeAs: requestPayload.object["ietf:cite-as"] }
        : {}),
      type: requestPayload.object.type,
      item: requestPayload.object["ietf:item"],
    },
    origin: { id: `${base}/system`, inbox: expectedInbox() },
    target,
    inReplyTo,
  });
  const payloadJson = canonicalJson(payload);
  const payloadHash = sha256(payloadJson);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.federationNotification.findUnique({ where: { activityId } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new FederationError(
            "Prepared activity id already has different immutable content.",
            "conflict",
          );
        }
        return;
      }
      const stored = await tx.federationNotification.create({
        data: {
          activityId,
          direction: "outbound",
          pattern: "announce-review",
          status: "prepared",
          actorUri: `${base}/system`,
          objectUri: versionUrl,
          contextUri: request.objectUri,
          originUri: `${base}/system`,
          originInbox: expectedInbox(),
          targetUri: target.id,
          targetInbox: target.inbox,
          inReplyTo,
          payloadJson,
          payloadHash,
          reviewVersionId: version.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "federation.announcement-prepared",
          subjectType: "federation-notification",
          subjectId: stored.id,
          idempotencyKey: `federation.prepare:${activityId}`,
          detailsJson: canonicalJson({ activityId, inReplyTo, payloadHash, versionId: version.id }),
        },
      });
    });
  } catch (error) {
    if (error instanceof FederationError) throw error;
    if (prismaCode(error) !== "P2002") throw error;
    const winner = await prisma.federationNotification.findUnique({ where: { activityId } });
    if (!winner || winner.payloadHash !== payloadHash) {
      throw new FederationError(
        "Prepared activity raced with different immutable content.",
        "conflict",
      );
    }
  }
  return payload;
}
