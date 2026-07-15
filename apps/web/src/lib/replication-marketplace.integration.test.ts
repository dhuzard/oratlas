import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { globalClaimId } from "@oratlas/contracts";
import { type PrismaClient } from "@oratlas/db";
import type * as Marketplace from "./replication-marketplace";
import type * as Synthesis from "./synthesis";

vi.mock("server-only", () => ({}));

const databasePath = resolve(
  process.cwd(),
  "packages/db/prisma",
  `.tmp-oratlas-replication-${process.pid}-${Date.now()}.db`,
);
// Prisma resolves SQLite file URLs relative to the schema directory.
const databaseUrl = `file:./${databasePath.split(/[\\/]/).at(-1)}`;

type Runtime = {
  prisma: PrismaClient;
  marketplace: typeof Marketplace;
  synthesis: typeof Synthesis;
};

let runtime: Runtime;
let editor: Marketplace.ReplicationActor;
let claimant: Marketplace.ReplicationActor;
let otherUser: Marketplace.ReplicationActor;
let versionId: string;

const draftInput = () => ({
  idempotencyKey: "1f83a8cb-03f7-43d1-b9a7-bcb61929cb72",
  slug: "independent-memory-cohort",
  title: "Independent memory cohort replication",
  summary:
    "Re-run the archived comparison in a separately recruited cohort under a registered protocol.",
  scope: {
    population: "Adults recruited independently of the archived cohort",
    outcome: "Pre-registered delayed-recall accuracy",
  },
  expectedInformationGain:
    "A separately recruited cohort would distinguish repeated analysis of one evidence family from convergence across independent evidence families.",
  effortBand: "medium" as const,
  citationUrls: ["https://example.org/evidence/memory-study"],
  claims: [{ reviewVersionId: versionId, localClaimId: "claim-memory" }],
});

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  const require = createRequire(import.meta.url);
  const prismaPackage = require.resolve("prisma/package.json", {
    paths: [resolve(process.cwd(), "packages/db")],
  });
  execFileSync(
    process.execPath,
    [
      resolve(dirname(prismaPackage), "build/index.js"),
      "db",
      "push",
      "--schema",
      "packages/db/prisma/schema.prisma",
      "--skip-generate",
    ],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );

  const { prisma } = await import("./db");
  const marketplace = await import("./replication-marketplace");
  const synthesis = await import("./synthesis");
  runtime = { prisma, marketplace, synthesis };

  const createUser = async (login: string, role: string) => {
    const row = await prisma.user.create({
      data: { githubUserId: `replication-${login}`, githubLogin: login, role },
    });
    return { id: row.id, role };
  };
  editor = await createUser("market-editor", "EDITOR");
  claimant = await createUser("market-claimant", "USER");
  otherUser = await createUser("market-observer", "USER");

  const repository = await prisma.repository.create({
    data: {
      owner: "atlas-lab",
      name: "memory-review",
      canonicalUrl: "https://github.com/atlas-lab/memory-review",
    },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha: "a".repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "b".repeat(64),
    },
  });
  const review = await prisma.review.create({
    data: {
      slug: "memory-review",
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
      title: "Memory review",
      status: "published",
    },
  });
  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: "Memory review",
      metadataJson: "{}",
      publicState: "published",
      publishedAt: new Date(),
    },
  });
  versionId = version.id;
  const claim = await prisma.claim.create({
    data: {
      reviewVersionId: version.id,
      localClaimId: "claim-memory",
      text: "The intervention improves delayed-recall accuracy.",
      normalizedText: "the intervention improves delayed recall accuracy",
      scopeJson: JSON.stringify({ population: "adults", outcome: "delayed recall" }),
    },
  });
  const citation = await prisma.citation.create({
    data: {
      reviewVersionId: version.id,
      localCitationId: "citation-memory",
      doi: "10.5555/independent-memory",
      title: "Independent memory study",
    },
  });
  await prisma.claimEvidenceRelation.create({
    data: {
      claimId: claim.id,
      citationId: citation.id,
      relationType: "supports",
      supportDirection: "supports",
    },
  });
}, 60_000);

afterAll(async () => {
  await runtime?.prisma.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("replication marketplace lifecycle", () => {
  it("keeps idempotent drafts private and publication human-editor-only", async () => {
    const { marketplace } = runtime;
    await expect(
      marketplace.createReplicationBriefDraft(claimant, draftInput()),
    ).rejects.toMatchObject({ code: "forbidden" });

    const created = await marketplace.createReplicationBriefDraft(editor, draftInput());
    expect(created).toEqual({
      slug: draftInput().slug,
      status: "draft",
      revision: 0,
      idempotent: false,
    });
    await expect(
      marketplace.createReplicationBriefDraft(editor, draftInput()),
    ).resolves.toMatchObject({
      slug: draftInput().slug,
      status: "draft",
      revision: 0,
      idempotent: true,
    });
    await expect(
      marketplace.createReplicationBriefDraft(editor, {
        ...draftInput(),
        title: "Edited content cannot reuse a committed draft identity",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      marketplace.listPublicReplicationBriefs({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ total: 0, briefs: [] });
    await expect(
      marketplace.transitionReplicationBrief(claimant, draftInput().slug, {
        action: "publish",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      marketplace.transitionReplicationBrief(claimant, draftInput().slug, {
        action: "claim",
        expectedRevision: 0,
        protocolUrl: "https://example.org/protocols/private-draft-probe",
        note: "A private draft must be indistinguishable from an unavailable marketplace brief.",
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    await expect(
      marketplace.transitionReplicationBrief(editor, draftInput().slug, {
        action: "publish",
        expectedRevision: 0,
      }),
    ).resolves.toEqual({ slug: draftInput().slug, status: "open", revision: 1 });

    const detail = await marketplace.getPublicReplicationBrief(draftInput().slug);
    expect(detail).toMatchObject({
      status: "open",
      revision: 1,
      createdByLogin: "market-editor",
      publishedByLogin: "market-editor",
      claims: [{ reviewVersionId: versionId, localClaimId: "claim-memory" }],
      triageSnapshot: {
        schemaVersion: "1.0.0",
        method: "oratlas-replication-triage-1.0",
        corpusHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        capturedAt: expect.any(String),
      },
    });
    const currentCorpusHash = await runtime.prisma.$transaction((tx) =>
      runtime.synthesis.getReplicationCorpusHash(tx),
    );
    expect((detail?.triageSnapshot as { corpusHash?: string }).corpusHash).toBe(currentCorpusHash);
    const cachedSnapshot = await runtime.synthesis.getReplicationTriageForClaimIds([
      globalClaimId(versionId, "claim-memory"),
    ]);
    expect(cachedSnapshot).toMatchObject({
      corpusHash: currentCorpusHash,
      capturedAt: (detail?.triageSnapshot as { capturedAt?: string }).capturedAt,
      rows: [{ localClaimId: "claim-memory" }],
    });
    const publicationAudit = await runtime.prisma.auditEvent.findFirstOrThrow({
      where: { action: "replication.brief-published" },
    });
    expect(JSON.parse(publicationAudit.detailsJson)).toMatchObject({
      corpusHash: currentCorpusHash,
      capturedAt: expect.any(String),
    });
    expect(JSON.stringify(detail)).not.toMatch(/truthScore|probability|personRank/i);
  }, 30_000);

  it("uses CAS for claiming and restricts completion to the attributable claimant", async () => {
    const { marketplace, prisma } = runtime;
    const attempts = await Promise.allSettled([
      marketplace.transitionReplicationBrief(claimant, draftInput().slug, {
        action: "claim",
        expectedRevision: 1,
        protocolUrl: "https://example.org/protocols/memory-replication",
        note: "We will preregister the sampling plan and analysis before collecting any data.",
      }),
      marketplace.transitionReplicationBrief(otherUser, draftInput().slug, {
        action: "claim",
        expectedRevision: 1,
        protocolUrl: "https://example.org/protocols/competing-replication",
        note: "A competing team attempts the same current brief revision at the same time.",
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);

    const claimed = await marketplace.getPublicReplicationBrief(draftInput().slug);
    expect(claimed).toMatchObject({ status: "claimed", revision: 2 });
    expect(claimed).not.toHaveProperty("claimedById");
    const stored = await prisma.replicationBrief.findUniqueOrThrow({
      where: { slug: draftInput().slug },
      select: { claimedById: true },
    });
    const winningActor = stored.claimedById === claimant.id ? claimant : otherUser;
    const losingActor = winningActor.id === claimant.id ? otherUser : claimant;
    await expect(
      marketplace.isReplicationBriefClaimant(draftInput().slug, winningActor.id),
    ).resolves.toBe(true);
    await expect(
      marketplace.isReplicationBriefClaimant(draftInput().slug, losingActor.id),
    ).resolves.toBe(false);

    await expect(
      marketplace.transitionReplicationBrief(losingActor, draftInput().slug, {
        action: "complete",
        expectedRevision: 2,
        completionUrl: "https://example.org/results/not-authorized",
        summary:
          "This completion attempt must be rejected because the actor did not claim the registered brief.",
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    await expect(
      marketplace.transitionReplicationBrief(winningActor, draftInput().slug, {
        action: "complete",
        expectedRevision: 2,
        completionUrl: "https://example.org/results/memory-replication",
        summary:
          "The claimant records that a public report and materials are available; Atlas makes no judgement about the result.",
      }),
    ).resolves.toEqual({ slug: draftInput().slug, status: "completed", revision: 3 });
    await expect(
      marketplace.transitionReplicationBrief(winningActor, draftInput().slug, {
        action: "complete",
        expectedRevision: 2,
        completionUrl: "https://example.org/results/stale-retry",
        summary:
          "A stale retry cannot record a second completion against an already advanced lifecycle revision.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const complete = await marketplace.getPublicReplicationBrief(draftInput().slug);
    expect(complete).toMatchObject({
      status: "completed",
      revision: 3,
      completedByLogin: claimed!.claimedByLogin,
      completionUrl: "https://example.org/results/memory-replication",
    });
    const audit = await prisma.auditEvent.findMany({
      where: { subjectType: "replication-brief" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      "replication.brief-drafted",
      "replication.brief-published",
      "replication.brief-claimed",
      "replication.brief-completed",
    ]);
  }, 30_000);

  it("keeps withdrawal attributable and editor-only", async () => {
    const { marketplace } = runtime;
    const input = {
      ...draftInput(),
      idempotencyKey: "fc86b10c-ec48-47a4-8ac8-30256d207fa8",
      slug: "independent-memory-cohort-withdrawn",
      title: "Withdrawn independent memory cohort replication",
      summary:
        "A second registered opportunity used to verify that public withdrawal remains explicit and attributable.",
    };
    await marketplace.createReplicationBriefDraft(editor, input);
    await marketplace.transitionReplicationBrief(editor, input.slug, {
      action: "publish",
      expectedRevision: 0,
    });
    await expect(
      marketplace.transitionReplicationBrief(claimant, input.slug, {
        action: "withdraw",
        expectedRevision: 1,
        reason: "A non-editor cannot withdraw a human-published replication opportunity.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await marketplace.transitionReplicationBrief(editor, input.slug, {
      action: "withdraw",
      expectedRevision: 1,
      reason: "The archived claim scope changed before any researcher claimed this opportunity.",
    });

    await expect(marketplace.getPublicReplicationBrief(input.slug)).resolves.toMatchObject({
      status: "withdrawn",
      revision: 2,
      withdrawnByLogin: "market-editor",
      withdrawalReason:
        "The archived claim scope changed before any researcher claimed this opportunity.",
    });
  }, 30_000);

  it("fails closed when claim or completion targets leave the readable corpus", async () => {
    const { marketplace, prisma } = runtime;
    const claimInput = {
      ...draftInput(),
      idempotencyKey: "1765e704-99b9-40e8-9af0-b7c595cc1046",
      slug: "temporarily-readable-replication",
      title: "Temporarily readable replication opportunity",
      summary:
        "A registered opportunity used to verify that claimant transitions fail closed after lifecycle removal.",
    };
    await marketplace.createReplicationBriefDraft(editor, claimInput);
    await marketplace.transitionReplicationBrief(editor, claimInput.slug, {
      action: "publish",
      expectedRevision: 0,
    });
    await prisma.reviewVersion.update({
      where: { id: versionId },
      data: { publicState: "tombstoned" },
    });
    await expect(
      marketplace.transitionReplicationBrief(claimant, claimInput.slug, {
        action: "claim",
        expectedRevision: 1,
        protocolUrl: "https://example.org/protocols/unreadable-claim",
        note: "An unreadable opportunity cannot be reserved through a direct transition request.",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
    await prisma.reviewVersion.update({
      where: { id: versionId },
      data: { publicState: "published" },
    });
    await marketplace.transitionReplicationBrief(claimant, claimInput.slug, {
      action: "claim",
      expectedRevision: 1,
      protocolUrl: "https://example.org/protocols/readable-claim",
      note: "The authenticated researcher claims the restored public opportunity transparently.",
    });
    await prisma.reviewVersion.update({
      where: { id: versionId },
      data: { publicState: "tombstoned" },
    });
    await expect(
      marketplace.transitionReplicationBrief(claimant, claimInput.slug, {
        action: "complete",
        expectedRevision: 2,
        completionUrl: "https://example.org/results/unreadable-completion",
        summary:
          "A hidden marketplace brief cannot accept a completion transition through its direct endpoint.",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
    await prisma.reviewVersion.update({
      where: { id: versionId },
      data: { publicState: "published" },
    });
  }, 30_000);

  it("keeps a greater-than-5000-claim corpus off the bounded anonymous public path", async () => {
    const { marketplace, prisma, synthesis } = runtime;
    const extraClaims = Array.from({ length: 5_001 }, (_, index) => ({
      reviewVersionId: versionId,
      localClaimId: `large-corpus-${String(index).padStart(5, "0")}`,
      text: `Large corpus claim ${index}`,
      normalizedText: `large corpus claim ${index}`,
    }));
    for (let offset = 0; offset < extraClaims.length; offset += 250) {
      await prisma.claim.createMany({ data: extraClaims.slice(offset, offset + 250) });
    }

    // The anonymous loader reads only publication-frozen snapshots. It does
    // not synthesize or imply that this is a live ranking of all 5,002 claims.
    const publicPage = await marketplace.loadPublicReplicationMarketplace();
    expect(publicPage.triage).toHaveLength(1);
    expect(publicPage.triage[0]).toMatchObject({
      claimId: globalClaimId(versionId, "claim-memory"),
      capturedAt: expect.any(String),
      sourceBriefSlug: expect.any(String),
    });

    // The actual current-corpus path also handles the large sparse corpus via
    // evidence-family indexing, rather than an unconditional all-pairs scan.
    const current = await synthesis.getReplicationTriage(30);
    expect(current).toHaveLength(30);
    expect(new Set(current.map((row) => row.claimId)).size).toBe(30);
    expect(JSON.stringify(current)).not.toMatch(/truthScore|probability|personRank/i);
  }, 60_000);
});
