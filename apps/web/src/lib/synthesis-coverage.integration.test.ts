import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";
import {
  buildPreparedSubgraphEvidencePacket,
  fingerprintSubgraphEvidenceSelection,
} from "@oratlas/knowledge";
import type { SessionUser } from "./auth";
import type * as Coverage from "./synthesis-coverage";
import type * as Editorial from "./synthesis-editorial";

vi.mock("server-only", () => ({}));

const fileName = `.tmp-oratlas-synthesis-coverage-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = `file:./${fileName}`;
const commit = (character: string) => character.repeat(40);
let prisma: PrismaClient;
let coverage: typeof Coverage;
let editorial: typeof Editorial;
let actor: SessionUser;
let repositoryId: string;
let snapshotId: string;
let sourceReviewId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  const require = createRequire(import.meta.url);
  const prismaPackage = require.resolve("prisma/package.json", {
    paths: [resolve(process.cwd(), "packages/db")],
  });
  const prismaCli = resolve(dirname(prismaPackage), "build/index.js");
  try {
    execFileSync(
      process.execPath,
      [prismaCli, "db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate"],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
    );
  } catch (error) {
    if (process.platform !== "win32") throw error;
    const ddl = execFileSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        "packages/db/prisma/schema.prisma",
        "--script",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" },
    );
    execFileSync("sqlite3", [databasePath], { input: ddl, stdio: ["pipe", "pipe", "pipe"] });
  }
  ({ prisma } = await import("./db"));
  await applyDatabaseGuards(prisma, "sqlite");
  coverage = await import("./synthesis-coverage");
  editorial = await import("./synthesis-editorial");
  const user = await prisma.user.create({
    data: { githubLogin: "coverage-editor", displayName: "Coverage Editor", role: "EDITOR" },
  });
  actor = {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: null,
    profileUrl: null,
    role: "EDITOR",
  };
  const repository = await prisma.repository.create({
    data: {
      owner: "coverage-lab",
      name: "topic-nodes",
      canonicalUrl: "https://github.com/coverage-lab/topic-nodes",
    },
  });
  repositoryId = repository.id;
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId,
      commitSha: commit("a"),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "b".repeat(64),
    },
  });
  snapshotId = snapshot.id;
  const sourceReview = await prisma.review.create({
    data: {
      repositoryId,
      currentSnapshotId: snapshot.id,
      slug: "coverage-source-review",
      title: "Coverage source review",
      status: "published",
    },
  });
  sourceReviewId = sourceReview.id;
  await prisma.reviewVersion.create({
    data: {
      reviewId: sourceReview.id,
      snapshotId: snapshot.id,
      title: "Coverage source review",
      metadataJson: "{}",
      publicState: "published",
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
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        if (existsSync(path)) rmSync(path);
        break;
      } catch {
        if (attempt === 5) break;
        await delay(25 * 2 ** attempt);
      }
    }
  }
});

async function createNode(id: string, versionId: string, title: string, createdAt: Date) {
  await prisma.knowledgeNode.create({
    data: { id, repositoryId, localNodeId: id, kind: "claim" },
  });
  return createVersion(id, versionId, title, createdAt, snapshotId, commit("a"));
}

async function createVersion(
  nodeId: string,
  id: string,
  title: string,
  createdAt: Date,
  versionSnapshotId: string,
  commitSha: string,
) {
  return prisma.knowledgeNodeVersion.create({
    data: {
      id,
      knowledgeNodeId: nodeId,
      snapshotId: versionSnapshotId,
      title,
      abstract: `${title} abstract.`,
      contributorsJson: '[{"displayName":"Coverage Researcher"}]',
      license: "CC-BY-4.0",
      provenanceJson: JSON.stringify({
        sourcePath: `nodes/${nodeId}.json`,
        repositoryUrl: "https://github.com/coverage-lab/topic-nodes",
        commitSha,
      }),
      payloadJson: JSON.stringify({ statement: `${title} statement.`, qualifiers: [] }),
      createdAt,
    },
  });
}

function selector(nodeId: string) {
  return {
    schemaVersion: "synthesis-selector/1.0.0" as const,
    selection: { kind: "seed" as const, nodeId },
    depth: 1,
    maxNodes: 10,
    maxEdges: 20,
    relationTypes: ["contradicts" as const],
    trustPolicy: "authoritative-current-relation-trust-v1" as const,
    currentVersionPolicy: "newest-valid-no-history-fallback" as const,
    topicSeedPolicy: "current-public-title-abstract-search-v1" as const,
    topicSeedLimit: 1,
    edgePolicy: "editor-confirmed-exact-versions-only" as const,
    includeContradictions: true as const,
  };
}

function prepared(
  nodeId: string,
  versionId: string,
  title: string,
  commitSha: string,
  versionSnapshotId = snapshotId,
) {
  const selection = { kind: "seed" as const, nodeId, versionId };
  return buildPreparedSubgraphEvidencePacket({
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: { nodeCount: 1, edgeCount: 0, contradictionEdgeIds: [] },
    nodes: [
      {
        id: nodeId,
        localNodeId: nodeId,
        repository: {
          owner: "coverage-lab",
          name: "topic-nodes",
          url: "https://github.com/coverage-lab/topic-nodes",
        },
        versionId,
        snapshotId: versionSnapshotId,
        commitSha,
        title,
        abstract: `${title} abstract.`,
        contributors: [{ displayName: "Coverage Researcher" }],
        license: "CC-BY-4.0",
        provenance: {
          sourcePath: `nodes/${nodeId}.json`,
          repositoryUrl: "https://github.com/coverage-lab/topic-nodes",
          commitSha,
        },
        identifiers: [],
        isExample: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "claim" as const,
        payload: { statement: `${title} statement.`, qualifiers: [] },
      },
    ],
    edges: [],
  });
}

function decision(idempotencyKey: string, versionDoi: string, conceptDoi: string) {
  return {
    action: "accept" as const,
    expectedRevision: 0,
    idempotencyKey,
    rationale: "The editor reviewed grounding, framing, attribution, limitations and rights.",
    licenseSpdx: "CC-BY-4.0",
    rightsStatement: "The editor confirms publication rights for this grounded synthesis.",
    versionDoi,
    conceptDoi,
    checklist: {
      groundingAndCitationsReviewed: true as const,
      contradictionAndNonConsensusFramingReviewed: true as const,
      attributionAndAiDisclosureReviewed: true as const,
      limitationsReviewed: true as const,
      privacyAndInjectionLeakageReviewed: true as const,
      rightsAndLicenseConfirmed: true as const,
    },
  };
}

function uncoveredIds(snapshot: Awaited<ReturnType<typeof coverage.getTopicCoverage>>) {
  return snapshot.groups.flatMap((group) => group.nodes.map((node) => node.id));
}

describe.sequential("synthesis topic coverage integration", () => {
  it("tracks exact current versions and excludes invalid synthesis and node heads", async () => {
    await createNode(
      "covered-claim",
      "covered-claim-v1",
      "Covered claim v1",
      new Date("2026-01-01"),
    );
    await createNode(
      "uncovered-claim",
      "uncovered-claim-v1",
      "Uncovered claim",
      new Date("2026-01-02"),
    );
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toEqual([
      "covered-claim",
      "uncovered-claim",
    ]);

    const firstDraft = await editorial.generateSynthesisDraft(
      { selector: selector("covered-claim"), requestKey: "coverage-generation-v1" },
      {
        client: prisma,
        actor,
        loadPacket: async () =>
          prepared("covered-claim", "covered-claim-v1", "Covered claim v1", commit("a")),
      },
    );
    const firstAccepted = await editorial.decideSynthesisDraft(
      firstDraft.id,
      decision("coverage-accept-v1", "10.5281/zenodo.810001", "10.5281/zenodo.810000"),
      actor,
      prisma,
    );
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toEqual(["uncovered-claim"]);

    await createNode("new-claim", "new-claim-v1", "Newly published claim", new Date("2026-01-03"));
    const newerSnapshot = await prisma.repositorySnapshot.create({
      data: {
        repositoryId,
        commitSha: commit("c"),
        inspectionStatus: "succeeded",
        inspectionReportJson: "{}",
        contentHash: "d".repeat(64),
      },
    });
    await prisma.reviewVersion.create({
      data: {
        reviewId: sourceReviewId,
        snapshotId: newerSnapshot.id,
        title: "Coverage source review update",
        metadataJson: "{}",
        publicState: "published",
      },
    });
    await createVersion(
      "covered-claim",
      "covered-claim-v2",
      "Covered claim v2",
      new Date("2026-02-01"),
      newerSnapshot.id,
      commit("c"),
    );
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toEqual([
      "covered-claim",
      "new-claim",
      "uncovered-claim",
    ]);

    const successor = await editorial.generateSynthesisDraft(
      { selector: selector("covered-claim"), requestKey: "coverage-generation-v2" },
      {
        client: prisma,
        actor,
        loadPacket: async () =>
          prepared(
            "covered-claim",
            "covered-claim-v2",
            "Covered claim v2",
            commit("c"),
            newerSnapshot.id,
          ),
      },
    );
    const secondAccepted = await editorial.decideSynthesisDraft(
      successor.id,
      decision("coverage-accept-v2", "10.5281/zenodo.810002", "10.5281/zenodo.810000"),
      actor,
      prisma,
    );
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toEqual([
      "new-claim",
      "uncovered-claim",
    ]);

    const review = await prisma.review.findUniqueOrThrow({
      where: { slug: secondAccepted.reviewSlug! },
    });
    await prisma.review.update({
      where: { id: review.id },
      data: { currentSynthesisVersionId: firstAccepted.reviewVersionId! },
    });
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toContain("covered-claim");
    await prisma.review.update({
      where: { id: review.id },
      data: { currentSynthesisVersionId: secondAccepted.reviewVersionId! },
    });

    const currentVersion = await prisma.reviewVersion.findUniqueOrThrow({
      where: { id: secondAccepted.reviewVersionId! },
    });
    await prisma.reviewVersion.update({
      where: { id: currentVersion.id },
      data: { synthesisDocumentHash: "f".repeat(64) },
    });
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toContain("covered-claim");
    await prisma.reviewVersion.update({
      where: { id: currentVersion.id },
      data: { synthesisDocumentHash: currentVersion.synthesisDocumentHash },
    });
    await prisma.reviewVersion.update({
      where: { id: currentVersion.id },
      data: { isExample: true },
    });
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toContain("covered-claim");
    await prisma.reviewVersion.update({
      where: { id: currentVersion.id },
      data: { isExample: false },
    });

    const privateDraft = await editorial.generateSynthesisDraft(
      { selector: selector("new-claim"), requestKey: "coverage-private-draft" },
      {
        client: prisma,
        actor,
        loadPacket: async () =>
          prepared("new-claim", "new-claim-v1", "Newly published claim", commit("a")),
      },
    );
    const rejectedDraft = await editorial.generateSynthesisDraft(
      { selector: selector("new-claim"), requestKey: "coverage-rejected-draft" },
      {
        client: prisma,
        actor,
        loadPacket: async () =>
          prepared("new-claim", "new-claim-v1", "Newly published claim", commit("a")),
      },
    );
    await editorial.decideSynthesisDraft(
      rejectedDraft.id,
      {
        action: "reject",
        expectedRevision: 0,
        idempotencyKey: "coverage-reject-decision",
        rationale: "The private draft does not meet the editorial publication requirements.",
      },
      actor,
      prisma,
    );
    expect(privateDraft.status).toBe("pending");
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).toContain("new-claim");

    await createNode(
      "invalid-head",
      "invalid-head-v1",
      "Valid historical node",
      new Date("2026-01-01"),
    );
    await prisma.knowledgeNodeVersion.create({
      data: {
        id: "invalid-head-v2",
        knowledgeNodeId: "invalid-head",
        snapshotId: newerSnapshot.id,
        title: "Invalid current node",
        contributorsJson: "[]",
        license: "CC-BY-4.0",
        provenanceJson: "{}",
        payloadJson: '{"injected":true}',
        createdAt: new Date("2026-03-01"),
      },
    });
    expect(uncoveredIds(await coverage.getTopicCoverage(prisma))).not.toContain("invalid-head");

    const serialized = JSON.stringify(await coverage.getTopicCoverage(prisma));
    expect(serialized).not.toMatch(/draft|membership|selector|packet|synthesisSlug/i);
  }, 60_000);
});
