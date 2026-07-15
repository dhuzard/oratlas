import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@oratlas/db";
import type * as ProtocolDrift from "./protocol-drift";

vi.mock("server-only", () => ({}));

const databaseFile = `oratlas-protocol-drift-${process.pid}-${Date.now()}.db`;
// Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
const databasePath = resolve(process.cwd(), "packages/db/prisma", databaseFile);
const databaseUrl = `file:./${databaseFile}`;
const fetchedAt = "2026-07-15T08:00:00.000Z";

let prisma: PrismaClient;
let drift: typeof ProtocolDrift;
let editor: { id: string; role: string };
let reader: { id: string; role: string };
let versionId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  pushTestSchema();
  ({ prisma } = await import("./db"));
  drift = await import("./protocol-drift");
  const editorRow = await prisma.user.create({
    data: { githubUserId: "protocol-editor", githubLogin: "protocol-editor", role: "EDITOR" },
  });
  const readerRow = await prisma.user.create({
    data: { githubUserId: "protocol-reader", githubLogin: "protocol-reader", role: "USER" },
  });
  editor = { id: editorRow.id, role: editorRow.role };
  reader = { id: readerRow.id, role: readerRow.role };
  const repository = await prisma.repository.create({
    data: {
      owner: "lab",
      name: "protocol-review",
      canonicalUrl: "https://github.com/lab/protocol-review",
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
      slug: "protocol-review",
      repositoryId: repository.id,
      title: "Protocol Review",
      status: "published",
    },
  });
  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      sourceSelectionKey: "default-branch:main",
      title: "Protocol Review",
      metadataJson: "{}",
      publishedAt: new Date(fetchedAt),
    },
  });
  versionId = version.id;
  await prisma.claim.create({
    data: {
      reviewVersionId: version.id,
      localClaimId: "claim-registered",
      text: "Sorting accuracy was measured in adults with chronic probes.",
      normalizedText: "sorting accuracy was measured in adults with chronic probes.",
      scopeJson: JSON.stringify({
        population: "Adults with chronic probes",
        outcome: "Spike yield",
        analysisPlan: "Allocation: RANDOMIZED",
      }),
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

function pushTestSchema(): void {
  const args = [
    resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
    "db",
    "push",
    "--schema",
    "packages/db/prisma/schema.prisma",
    "--skip-generate",
  ];
  for (let attempt = 0; ; attempt += 1) {
    try {
      // The Prisma Windows schema engine can fail transiently while its binary
      // is being scanned/loaded in a Vitest worker; bounded retries keep this
      // provider-level integration test deterministic without masking errors.
      execFileSync(process.execPath, args, {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          RUST_LOG: "info",
          RUST_BACKTRACE: "1",
        },
        stdio: "inherit",
      });
      return;
    } catch (error) {
      if (existsSync(databasePath)) rmSync(databasePath);
      if (attempt >= 2) throw error;
    }
  }
}

describe.sequential("Protocol Drift Radar persistence", () => {
  it("authorizes editors, persists provenance, and creates neutral stable proposals", async () => {
    const input = clinicalInput();
    await expect(drift.registerProtocolSnapshot(reader, input)).rejects.toMatchObject({
      code: "forbidden",
    });

    const created = await drift.registerProtocolSnapshot(editor, input);
    expect(created).toMatchObject({
      sourceId: "NCT01234567",
      idempotent: false,
      publicPath: `/claims/${versionId}/claim-registered`,
    });
    expect(created.proposalsOpened).toBe(2);

    const stored = await prisma.protocolSnapshot.findUniqueOrThrow({
      where: { id: created.snapshotId },
      include: { proposals: true },
    });
    expect(stored.rawJson).toContain("NCT01234567");
    expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.sourceVersion).toBe('W/"trial-v7"');
    expect(stored.proposals.map((proposal) => proposal.category).sort()).toEqual([
      "exclusions",
      "outcomes",
    ]);
    expect(stored.proposals.every((proposal) => proposal.rationale.includes("Human review"))).toBe(
      true,
    );
    expect(JSON.stringify(stored.proposals).toLowerCase()).not.toMatch(
      /misconduct|fraud|violation/,
    );

    const publicSummary = await drift.getPublicProtocolSummary(versionId, "claim-registered");
    expect(publicSummary?.openCount).toBe(2);
    expect(publicSummary?.snapshots[0]?.contentHash).toBe(stored.contentHash);
    expect(publicSummary?.snapshots[0]).not.toHaveProperty("rawJson");
    expect(await drift.getPublicProtocolSummary("missing-version")).toBeNull();
  });

  it("is retry-idempotent and rejects a mutable upstream version marker", async () => {
    const first = await drift.registerProtocolSnapshot(editor, clinicalInput());
    expect(first.idempotent).toBe(true);
    expect(first.proposalsOpened).toBe(0);
    expect(await prisma.protocolSnapshot.count()).toBe(1);
    expect(await prisma.protocolDriftProposal.count()).toBe(2);
    expect(
      await prisma.auditEvent.count({ where: { action: "protocol.snapshot-registered" } }),
    ).toBe(1);

    const concurrentInput = { ...clinicalInput(), sourceVersion: 'W/"trial-v8"' };
    const concurrent = await Promise.all([
      drift.registerProtocolSnapshot(editor, concurrentInput),
      drift.registerProtocolSnapshot(editor, concurrentInput),
    ]);
    expect(new Set(concurrent.map((result) => result.snapshotId)).size).toBe(1);
    expect(concurrent.filter((result) => !result.idempotent)).toHaveLength(1);
    expect(await prisma.protocolSnapshot.count()).toBe(2);
    expect(
      await prisma.auditEvent.count({ where: { action: "protocol.snapshot-registered" } }),
    ).toBe(2);

    const changed = clinicalInput();
    (changed.payload as TrialPayload).protocolSection.identificationModule.briefTitle =
      "Silently changed title";
    await expect(drift.registerProtocolSnapshot(editor, changed)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("binds immutable OSF question metadata to the captured version", async () => {
    const input = osfInput();
    const created = await drift.registerProtocolSnapshot(editor, input);
    const stored = await prisma.protocolSnapshot.findUniqueOrThrow({
      where: { id: created.snapshotId },
    });
    expect(JSON.parse(stored.questionMetadataJson ?? "null")).toEqual(input.osfQuestions);

    await expect(
      drift.registerProtocolSnapshot(editor, {
        ...input,
        osfQuestions: [{ id: "q_population", label: "Primary outcome", category: "outcomes" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("resolves proposals once with attribution and fails closed on malformed sources", async () => {
    const proposal = await prisma.protocolDriftProposal.findFirstOrThrow({
      where: { status: "open" },
    });
    await expect(
      drift.resolveProtocolProposal(reader, proposal.id, {
        resolution: "explained",
        note: "Readers cannot resolve this proposal.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await drift.resolveProtocolProposal(editor, proposal.id, {
      resolution: "explained",
      note: "The outcome wording changed after a registered amendment.",
    });
    await expect(
      drift.resolveProtocolProposal(editor, proposal.id, {
        resolution: "dismissed",
        note: "A second resolution must not overwrite attribution.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const resolved = await prisma.protocolDriftProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: { resolvedBy: true },
    });
    expect(resolved.resolvedBy?.githubLogin).toBe("protocol-editor");
    expect(resolved.resolutionNote).toContain("registered amendment");

    await expect(
      drift.registerProtocolSnapshot(editor, {
        ...clinicalInput(),
        sourceVersion: "malformed-v1",
        payload: { protocolSection: {} },
      }),
    ).rejects.toThrow();
    await expect(
      drift.registerProtocolSnapshot(editor, {
        ...clinicalInput(),
        sourceUrl: "https://clinicaltrials.gov/study/NCT99999999",
        sourceVersion: "mismatched-source-v1",
      }),
    ).rejects.toThrow(/does not identify the source id/i);
    await expect(
      drift.registerProtocolSnapshot(editor, {
        reviewVersionId: versionId,
        registry: "osf",
        sourceUrl: "https://osf.io/abc12/",
        sourceVersion: "v1",
        fetchedAt,
        payload: { data: {} },
      }),
    ).rejects.toThrow();

    const claim = await prisma.claim.findFirstOrThrow({
      where: { reviewVersionId: versionId, localClaimId: "claim-registered" },
    });
    await prisma.claim.update({ where: { id: claim.id }, data: { scopeJson: "{" } });
    await expect(
      drift.registerProtocolSnapshot(editor, {
        ...clinicalInput(),
        sourceVersion: 'W/"malformed-scope-v1"',
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await prisma.claim.update({ where: { id: claim.id }, data: { scopeJson: claim.scopeJson } });
  });
});

interface TrialPayload {
  protocolSection: {
    identificationModule: { nctId: string; briefTitle: string };
    statusModule: {
      studyFirstPostDateStruct: { date: string };
      lastUpdatePostDateStruct: { date: string };
    };
    eligibilityModule: { eligibilityCriteria: string };
    outcomesModule: { primaryOutcomes: Array<{ measure: string }> };
    designModule: { designInfo: { allocation: string } };
  };
}

function clinicalInput() {
  const payload: TrialPayload = {
    protocolSection: {
      identificationModule: { nctId: "NCT01234567", briefTitle: "Dense probe protocol" },
      statusModule: {
        studyFirstPostDateStruct: { date: "2025-01-01" },
        lastUpdatePostDateStruct: { date: "2026-07-14" },
      },
      eligibilityModule: {
        eligibilityCriteria:
          "Inclusion Criteria:\nAdults with chronic probes\n\nExclusion Criteria:\nPrior implant infection",
      },
      outcomesModule: { primaryOutcomes: [{ measure: "Sorting accuracy" }] },
      designModule: { designInfo: { allocation: "RANDOMIZED" } },
    },
  };
  return {
    reviewVersionId: versionId,
    claimLocalId: "claim-registered",
    registry: "clinicaltrials-gov" as const,
    sourceUrl: "https://clinicaltrials.gov/study/NCT01234567",
    sourceVersion: 'W/"trial-v7"',
    fetchedAt,
    payload,
  };
}

function osfInput() {
  return {
    reviewVersionId: versionId,
    claimLocalId: "claim-registered",
    registry: "osf" as const,
    sourceUrl: "https://osf.io/abc12/",
    sourceVersion: "osf-v1",
    fetchedAt,
    payload: {
      data: {
        id: "abc12",
        attributes: {
          title: "Registered review protocol",
          date_registered: "2026-01-01T00:00:00.000Z",
          date_modified: "2026-01-02T00:00:00.000Z",
          registered_meta: { q_population: { value: "Adults with chronic probes" } },
        },
      },
    },
    osfQuestions: [
      { id: "q_population", label: "Target population", category: "population" as const },
    ],
  };
}
