import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@oratlas/db";
import type * as Federation from "./federation";

vi.mock("server-only", () => ({}));

const externalDatabaseUrl = process.env.FEDERATION_TEST_DATABASE_URL;
const databaseFile = `oratlas-federation-${process.pid}-${Date.now()}.db`;
const databasePath = externalDatabaseUrl
  ? undefined
  : resolve(process.cwd(), "packages/db/prisma", databaseFile);
const databaseUrl = externalDatabaseUrl ?? `file:./${databaseFile}`;
const databaseSchema = externalDatabaseUrl
  ? "packages/db/prisma/schema.postgres.prisma"
  : "packages/db/prisma/schema.prisma";
const baseUrl = "http://localhost:3000";
const activityId = "urn:uuid:0370c0fb-bb78-4a9b-87f5-bed307a509dd";

type Runtime = { prisma: PrismaClient; federation: typeof Federation };
let runtime: Runtime;
let editor: { id: string; role: string };
let user: { id: string; role: string };
let versionId: string;

function requestReview(id = activityId) {
  return {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
    actor: { id: "https://orcid.org/0000-0002-1825-0097", name: "Reviewer", type: "Person" },
    id,
    object: {
      id: "https://repository.example/preprint/421",
      "ietf:cite-as": "https://doi.org/10.5555/12345680",
      "ietf:item": {
        id: "https://repository.example/preprint/421/content.pdf",
        mediaType: "application/pdf",
        type: ["Article", "sorg:ScholarlyArticle"],
      },
      type: ["Page", "sorg:AboutPage"],
    },
    origin: {
      id: "https://repository.example/system",
      inbox: "https://repository.example/inbox",
      type: "Service",
    },
    target: {
      id: `${baseUrl}/system`,
      inbox: `${baseUrl}/api/federation/inbox`,
      type: "Service",
    },
    type: ["Offer", "coar-notify:ReviewAction"],
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_BASE_URL = baseUrl;
  process.env.AUTH_MOCK = "1";
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      databaseSchema,
      "--skip-generate",
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        RUST_BACKTRACE: "1",
        RUST_LOG: "info",
      },
      stdio: "pipe",
    },
  );
  const { prisma } = await import("./db");
  runtime = { prisma, federation: await import("./federation") };
  const editorRow = await prisma.user.create({
    data: { githubUserId: "fed-editor", githubLogin: "fed-editor", role: "EDITOR" },
  });
  const userRow = await prisma.user.create({
    data: { githubUserId: "fed-user", githubLogin: "fed-user", role: "USER" },
  });
  editor = { id: editorRow.id, role: editorRow.role };
  user = { id: userRow.id, role: userRow.role };

  const repository = await prisma.repository.create({
    data: {
      owner: "federation-lab",
      name: "federated-review",
      canonicalUrl: "https://github.com/federation-lab/federated-review",
    },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha: "a".repeat(40),
      sourceTreeSha: "b".repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "c".repeat(64),
    },
  });
  const review = await prisma.review.create({
    data: { slug: "federated-review", repositoryId: repository.id, title: "Federated review" },
  });
  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: review.title,
      metadataJson: "{}",
      versionDoi: "10.1234/federated-review.v1",
      publishedAt: new Date("2026-07-15T08:00:00Z"),
    },
  });
  versionId = version.id;
}, 60_000);

afterAll(async () => {
  await runtime?.prisma.$disconnect();
  if (!databasePath) return;
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("federated review service", () => {
  it("persists immutable inbound requests and deduplicates exact retries", async () => {
    const deliveries = await Promise.all([
      runtime.federation.receiveFederationNotification(requestReview()),
      runtime.federation.receiveFederationNotification(requestReview()),
    ]);
    const first = deliveries.find((delivery) => !delivery.deduplicated)!;
    expect(first).toMatchObject({
      pattern: "request-review",
      status: "pending",
      deduplicated: false,
    });
    const replay = deliveries.find((delivery) => delivery.deduplicated)!;
    expect(replay).toMatchObject({ id: first.id, deduplicated: true });
    await expect(
      runtime.federation.receiveFederationNotification({
        ...requestReview(),
        actor: { ...requestReview().actor, name: "Changed identity assertion" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await runtime.prisma.federationNotification.count()).toBe(1);
    expect(
      await runtime.prisma.auditEvent.count({
        where: { action: "federation.notification-received" },
      }),
    ).toBe(1);
    const inbox = await runtime.federation.listFederationInbox();
    expect(inbox.document.contains).toEqual([]);
    await expect(runtime.federation.getFederationNotificationPayload(first.id)).resolves.toBeNull();
  });

  it("rejects notifications addressed to a different inbox", async () => {
    const wrong = requestReview("urn:uuid:11111111-1111-4111-8111-111111111111");
    wrong.target.inbox = "https://other.example/inbox";
    await expect(runtime.federation.receiveFederationNotification(wrong)).rejects.toThrow(
      /target inbox/i,
    );
  });

  it("requires an editor and resolves a request exactly once", async () => {
    const item = (await runtime.federation.listFederationQueue())[0]!;
    await expect(
      runtime.federation.resolveFederationNotification(user, item.id, {
        decision: "accepted",
        note: "We can coordinate an editorial review.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      runtime.federation.resolveFederationNotification(editor, item.id, {
        decision: "accepted",
        note: "We can coordinate an editorial review.",
      }),
    ).resolves.toEqual({ id: item.id, status: "accepted" });
    await expect(
      runtime.federation.resolveFederationNotification(editor, item.id, {
        decision: "rejected",
        note: "This second decision must never overwrite the first.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const secondActivityId = "urn:uuid:22222222-2222-4222-8222-222222222222";
    const rejectedActivityId = "urn:uuid:33333333-3333-4333-8333-333333333333";
    const second = await runtime.federation.receiveFederationNotification(
      requestReview(secondActivityId),
    );
    const rejected = await runtime.federation.receiveFederationNotification(
      requestReview(rejectedActivityId),
    );
    await runtime.federation.resolveFederationNotification(editor, second.id, {
      decision: "accepted",
      note: "This request is also suitable for editorial coordination.",
    });
    await runtime.federation.resolveFederationNotification(editor, rejected.id, {
      decision: "rejected",
      note: "This request is outside the editorial scope of this service.",
    });

    const firstPage = await runtime.federation.listFederationInbox({ limit: 1 });
    expect(firstPage.document.contains).toHaveLength(1);
    expect(firstPage.nextUrl).toBeDefined();
    const nextUrl = new URL(firstPage.nextUrl!);
    const cursor = nextUrl.searchParams.get("cursor");
    expect(cursor).toBeTruthy();
    expect(nextUrl.searchParams.get("limit")).toBe("1");
    const secondPage = await runtime.federation.listFederationInbox({ cursor: cursor!, limit: 1 });
    expect(secondPage.document.contains).toHaveLength(1);
    expect(secondPage.nextUrl).toBeUndefined();

    const publicUrls = [...firstPage.document.contains, ...secondPage.document.contains];
    expect(publicUrls).toEqual(
      expect.arrayContaining([
        `${baseUrl}/api/federation/notifications/${encodeURIComponent(item.id)}`,
        `${baseUrl}/api/federation/notifications/${encodeURIComponent(second.id)}`,
      ]),
    );
    expect(publicUrls).not.toContain(
      `${baseUrl}/api/federation/notifications/${encodeURIComponent(rejected.id)}`,
    );
    await expect(runtime.federation.getFederationNotificationPayload(item.id)).resolves.toEqual(
      requestReview(),
    );
    await expect(
      runtime.federation.getFederationNotificationPayload(rejected.id),
    ).resolves.toBeNull();
    await expect(
      runtime.federation.listFederationInbox({ cursor: rejected.id }),
    ).rejects.toMatchObject({ code: "bad-request" });
  });

  it("projects readable versions as COAR Notify announcements and hides tombstones", async () => {
    const payload = (await runtime.federation.prepareVersionReviewAnnouncement(
      editor,
      "federated-review",
      versionId,
      activityId,
    )) as {
      type: string[];
      context: { id: string; "ietf:cite-as": string };
      object: { id: string; "ietf:cite-as": string };
      inReplyTo: string;
    };
    expect(payload.type).toEqual(["Announce", "coar-notify:ReviewAction"]);
    expect(payload.context.id).toBe("https://repository.example/preprint/421");
    expect(payload.context["ietf:cite-as"]).toBe("https://doi.org/10.5555/12345680");
    expect(payload.object.id).toBe(`${baseUrl}/reviews/federated-review/versions/${versionId}`);
    expect(payload.object["ietf:cite-as"]).toBe("https://doi.org/10.1234/federated-review.v1");
    expect(payload.object).toMatchObject({
      "ietf:item": {
        id: `${baseUrl}/api/reviews/federated-review/versions/${versionId}/export/json`,
        mediaType: "application/vnd.oratlas.scholarly+json",
      },
      "https://oratlas.org/ns/exports": [
        {
          id: `${baseUrl}/api/reviews/federated-review/versions/${versionId}/export/ro-crate`,
          mediaType: "application/ld+json",
        },
      ],
    });
    expect(payload.inReplyTo).toBe(activityId);
    await expect(
      runtime.federation.prepareVersionReviewAnnouncement(
        editor,
        "federated-review",
        versionId,
        activityId,
      ),
    ).resolves.toEqual(payload);
    await expect(
      runtime.federation.prepareVersionReviewAnnouncement(
        user,
        "federated-review",
        versionId,
        activityId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await runtime.prisma.federationNotification.count({
        where: { direction: "outbound", reviewVersionId: versionId, inReplyTo: activityId },
      }),
    ).toBe(1);

    await runtime.prisma.reviewVersion.update({
      where: { id: versionId },
      data: { publicState: "tombstoned" },
    });
    await expect(
      runtime.federation.prepareVersionReviewAnnouncement(
        editor,
        "federated-review",
        versionId,
        activityId,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});
