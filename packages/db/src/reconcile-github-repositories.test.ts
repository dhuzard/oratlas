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

async function count(table: string): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM "${table}"`,
  );
  return Number(row?.count ?? 0);
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
}
