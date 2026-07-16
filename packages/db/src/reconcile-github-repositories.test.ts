import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client/index.js";
import { reconcileGithubRepositories } from "./reconcile-github-repositories.js";

const databasePath = `/tmp/oratlas-reconcile-${process.pid}-${Date.now()}.db`;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  await createLegacySchema(prisma);
  await seedDuplicateIdentityGraph(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("legacy GitHub repository reconciliation", () => {
  it("preflights duplicate ids without mutating linked rows", async () => {
    const report = await reconcileGithubRepositories(prisma, false);
    expect(report.duplicates).toEqual([
      {
        githubRepositoryId: "4242",
        count: 2,
        repositoryIds: ["repo-new", "repo-old"],
      },
    ]);
    expect(await count("Repository")).toBe(2);
  });

  it("merges duplicate repositories and rewires snapshots, submissions and reviews", async () => {
    const report = await reconcileGithubRepositories(prisma, true);
    expect(report.mergedRepositoryIds).toEqual(["repo-old"]);
    expect(await count("Repository")).toBe(1);
    const snapshots = await prisma.$queryRawUnsafe<
      Array<{ id: string; repositoryId: string; commitSha: string }>
    >("SELECT id, repositoryId, commitSha FROM RepositorySnapshot ORDER BY commitSha");
    expect(snapshots).toEqual([
      { id: "snap-new", repositoryId: "repo-new", commitSha: "a".repeat(40) },
      { id: "snap-old-only", repositoryId: "repo-new", commitSha: "b".repeat(40) },
    ]);
    const [submission] = await prisma.$queryRawUnsafe<
      Array<{ repositoryId: string; snapshotId: string }>
    >("SELECT repositoryId, snapshotId FROM Submission WHERE id = 'submission-old'");
    expect(submission).toEqual({ repositoryId: "repo-new", snapshotId: "snap-new" });
    const [review] = await prisma.$queryRawUnsafe<Array<{ currentSnapshotId: string }>>(
      "SELECT currentSnapshotId FROM Review WHERE id = 'review-new'",
    );
    expect(review?.currentSnapshotId).toBe("snap-new");
    const [version] = await prisma.$queryRawUnsafe<Array<{ snapshotId: string }>>(
      "SELECT snapshotId FROM ReviewVersion WHERE id = 'version-old'",
    );
    expect(version?.snapshotId).toBe("snap-new");
    expect(await count("Review")).toBe(1);
    const [movedVersion] = await prisma.$queryRawUnsafe<Array<{ reviewId: string }>>(
      "SELECT reviewId FROM ReviewVersion WHERE id = 'version-old'",
    );
    expect(movedVersion?.reviewId).toBe("review-new");
    const nodes = await prisma.$queryRawUnsafe<
      Array<{ id: string; repositoryId: string; localNodeId: string }>
    >("SELECT id, repositoryId, localNodeId FROM KnowledgeNode ORDER BY localNodeId");
    expect(nodes).toEqual([
      { id: "node-old-only", repositoryId: "repo-new", localNodeId: "old-only" },
      { id: "node-new", repositoryId: "repo-new", localNodeId: "shared-node" },
    ]);
    const nodeVersions = await prisma.$queryRawUnsafe<
      Array<{ id: string; knowledgeNodeId: string; snapshotId: string }>
    >("SELECT id, knowledgeNodeId, snapshotId FROM KnowledgeNodeVersion ORDER BY knowledgeNodeId");
    expect(nodeVersions).toEqual([
      { id: "node-version-new", knowledgeNodeId: "node-new", snapshotId: "snap-new" },
      {
        id: "node-version-old-only",
        knowledgeNodeId: "node-old-only",
        snapshotId: "snap-old-only",
      },
    ]);
    expect(await count("NodeEdge")).toBe(1);
    const [claim] = await prisma.$queryRawUnsafe<Array<{ knowledgeNodeId: string }>>(
      "SELECT knowledgeNodeId FROM Claim WHERE id = 'claim-old'",
    );
    expect(claim?.knowledgeNodeId).toBe("node-new");
    expect(await count("AuditEvent")).toBe(1);
  });

  it("backfills the stable Review.repositoryId after the schema adds that column", async () => {
    await prisma.$executeRawUnsafe("ALTER TABLE Review ADD COLUMN repositoryId TEXT");
    const report = await reconcileGithubRepositories(prisma, true);
    expect(report.duplicates).toEqual([]);
    expect(report.backfilledReviewIds).toEqual(["review-new"]);
    const [review] = await prisma.$queryRawUnsafe<Array<{ repositoryId: string }>>(
      "SELECT repositoryId FROM Review WHERE id = 'review-new'",
    );
    expect(review?.repositoryId).toBe("repo-new");
  });
});

describe("fail-closed knowledge-node reconciliation", () => {
  it("rejects colliding identities with different kinds", async () => {
    await withFreshFixture(async (client) => {
      await client.$executeRawUnsafe(
        "UPDATE KnowledgeNode SET kind = 'dataset' WHERE id = 'node-old'",
      );
      await expect(reconcileGithubRepositories(client, true)).rejects.toThrow(/kind mismatch/);
      expect(await countWith(client, "Repository")).toBe(2);
    });
  });

  it.each([
    ["payloadJson", '{"statement":"changed"}'],
    ["versionDoi", "10.5555/different-version"],
    ["sourceSubmissionId", "different-submission"],
    ["inspectionCaptureId", "different-capture"],
    ["capturePayloadHash", "different-capture-hash"],
  ])("rejects duplicate versions when %s differs", async (field, value) => {
    await withFreshFixture(async (client) => {
      await client.$executeRawUnsafe(
        `UPDATE KnowledgeNodeVersion SET "${field}" = ? WHERE id = 'node-version-old'`,
        value,
      );
      await expect(reconcileGithubRepositories(client, true)).rejects.toThrow(
        new RegExp(`semantic fields differ \\(${field}\\)`),
      );
      expect(await countWith(client, "KnowledgeNodeVersion")).toBe(3);
    });
  });

  it.each([
    ["status", "rejected"],
    ["provenance", "proposed-by-agent"],
    ["rationale", "Different rationale"],
    ["assertedAt", "2027-01-01T00:00:00.000Z"],
  ])("rejects duplicate edges when %s differs", async (field, value) => {
    await withFreshFixture(async (client) => {
      await client.$executeRawUnsafe(
        `UPDATE NodeEdge SET "${field}" = ? WHERE id = 'edge-old'`,
        value,
      );
      await expect(reconcileGithubRepositories(client, true)).rejects.toThrow(
        new RegExp(`semantic fields differ \\(${field}\\)`),
      );
      expect(await countWith(client, "NodeEdge")).toBe(2);
    });
  });

  it("deduplicates exact semantic equality", async () => {
    await withFreshFixture(async (client) => {
      const report = await reconcileGithubRepositories(client, true);
      expect(report.mergedRepositoryIds).toEqual(["repo-old"]);
      expect(await countWith(client, "KnowledgeNodeVersion")).toBe(2);
      expect(await countWith(client, "NodeEdge")).toBe(1);
    });
  });
});

async function count(table: string): Promise<number> {
  return countWith(prisma, table);
}

async function countWith(client: PrismaClient, table: string): Promise<number> {
  const [row] = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM "${table}"`,
  );
  return Number(row?.count ?? 0);
}

let fixtureCounter = 0;

async function withFreshFixture(run: (client: PrismaClient) => Promise<void>): Promise<void> {
  fixtureCounter += 1;
  const path = `/tmp/oratlas-reconcile-adversarial-${process.pid}-${fixtureCounter}-${Date.now()}.db`;
  const client = new PrismaClient({ datasourceUrl: `file:${path}` });
  try {
    await createLegacySchema(client);
    await seedDuplicateIdentityGraph(client);
    await run(client);
  } finally {
    await client.$disconnect();
    for (const candidate of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) rmSync(candidate);
    }
  }
}

async function createLegacySchema(client: PrismaClient): Promise<void> {
  const statements = [
    `CREATE TABLE Repository (
      id TEXT PRIMARY KEY, githubRepositoryId INTEGER, owner TEXT, name TEXT,
      canonicalUrl TEXT, createdAt TEXT, updatedAt TEXT
    )`,
    `CREATE TABLE RepositorySnapshot (
      id TEXT PRIMARY KEY, repositoryId TEXT, commitSha TEXT
    )`,
    `CREATE TABLE Submission (
      id TEXT PRIMARY KEY, repositoryId TEXT, snapshotId TEXT, resultingReviewId TEXT
    )`,
    `CREATE TABLE Review (
      id TEXT PRIMARY KEY, currentSnapshotId TEXT
    )`,
    `CREATE TABLE ReviewVersion (
      id TEXT PRIMARY KEY, reviewId TEXT, snapshotId TEXT
    )`,
    `CREATE TABLE AuditEvent (
      id TEXT PRIMARY KEY, action TEXT, subjectType TEXT, subjectId TEXT,
      detailsJson TEXT, createdAt TEXT
    )`,
    `CREATE TABLE KnowledgeNode (
      id TEXT PRIMARY KEY, repositoryId TEXT, localNodeId TEXT, kind TEXT,
      UNIQUE(repositoryId, localNodeId)
    )`,
    `CREATE TABLE KnowledgeNodeVersion (
      id TEXT PRIMARY KEY, knowledgeNodeId TEXT, snapshotId TEXT,
      title TEXT, abstract TEXT, text TEXT, contributorsJson TEXT, license TEXT,
      provenanceJson TEXT, payloadJson TEXT, versionDoi TEXT, conceptDoi TEXT,
      isExample INTEGER, sourceSubmissionId TEXT, inspectionCaptureId TEXT,
      capturePayloadHash TEXT, createdAt TEXT,
      UNIQUE(knowledgeNodeId, snapshotId)
    )`,
    `CREATE TABLE NodeEdge (
      id TEXT PRIMARY KEY, sourceNodeVersionId TEXT, targetNodeId TEXT, relationType TEXT,
      status TEXT, provenance TEXT, rationale TEXT, assertedAt TEXT, createdAt TEXT, updatedAt TEXT,
      UNIQUE(sourceNodeVersionId, targetNodeId, relationType)
    )`,
    `CREATE TABLE Claim (
      id TEXT PRIMARY KEY, knowledgeNodeId TEXT
    )`,
  ];
  for (const statement of statements) await client.$executeRawUnsafe(statement);
}

async function seedDuplicateIdentityGraph(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(
    `INSERT INTO Repository VALUES
      ('repo-old', 4242, 'old-owner', 'old-name', 'https://github.com/old-owner/old-name', '2025-01-01', '2025-01-01'),
      ('repo-new', 4242, 'new-owner', 'new-name', 'https://github.com/new-owner/new-name', '2026-01-01', '2026-01-01')`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO RepositorySnapshot VALUES
      ('snap-old', 'repo-old', ?),
      ('snap-new', 'repo-new', ?),
      ('snap-old-only', 'repo-old', ?)`,
    "a".repeat(40),
    "a".repeat(40),
    "b".repeat(40),
  );
  await client.$executeRawUnsafe(
    "INSERT INTO Submission VALUES ('submission-old', 'repo-old', 'snap-old', 'review-old')",
  );
  await client.$executeRawUnsafe("INSERT INTO Review VALUES ('review-old', 'snap-old')");
  await client.$executeRawUnsafe("INSERT INTO Review VALUES ('review-new', 'snap-new')");
  await client.$executeRawUnsafe(
    "INSERT INTO ReviewVersion VALUES ('version-old', 'review-old', 'snap-old')",
  );
  await client.$executeRawUnsafe(
    "INSERT INTO ReviewVersion VALUES ('version-new', 'review-new', 'snap-new')",
  );
  await client.$executeRawUnsafe(
    `INSERT INTO KnowledgeNode VALUES
      ('node-old', 'repo-old', 'shared-node', 'claim'),
      ('node-new', 'repo-new', 'shared-node', 'claim'),
      ('node-old-only', 'repo-old', 'old-only', 'dataset')`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO KnowledgeNodeVersion VALUES
      ('node-version-old', 'node-old', 'snap-old', 'Shared title', 'Shared abstract', 'Shared text',
       '[]', 'CC-BY-4.0', '{"sourcePath":"nodes/shared.json"}',
       '{"statement":"Shared claim","qualifiers":[]}', '10.5555/shared.v1',
       '10.5555/shared.concept', 1, NULL, NULL, 'shared-capture-hash', '2026-01-01T00:00:00.000Z'),
      ('node-version-new', 'node-new', 'snap-new', 'Shared title', 'Shared abstract', 'Shared text',
       '[]', 'CC-BY-4.0', '{"sourcePath":"nodes/shared.json"}',
       '{"statement":"Shared claim","qualifiers":[]}', '10.5555/shared.v1',
       '10.5555/shared.concept', 1, NULL, NULL, 'shared-capture-hash', '2026-01-01T00:00:00.000Z'),
      ('node-version-old-only', 'node-old-only', 'snap-old-only', 'Old-only dataset', NULL, NULL,
       '[]', 'CC-BY-4.0', '{"sourcePath":"nodes/old-only.json"}',
       '{"artifactPath":"data/old.csv","format":"text/csv","sizeBytes":10}', NULL,
       NULL, 0, NULL, NULL, NULL, '2026-01-02T00:00:00.000Z')`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO NodeEdge VALUES
      ('edge-old', 'node-version-old', 'node-old', 'supports', 'confirmed',
       'confirmed-by-editor', 'Same rationale', '2026-01-03T00:00:00.000Z',
       '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
      ('edge-new', 'node-version-new', 'node-new', 'supports', 'confirmed',
       'confirmed-by-editor', 'Same rationale', '2026-01-03T00:00:00.000Z',
       '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`,
  );
  await client.$executeRawUnsafe("INSERT INTO Claim VALUES ('claim-old', 'node-old')");
}
