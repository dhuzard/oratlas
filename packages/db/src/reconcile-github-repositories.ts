import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "../generated/client/index.js";

interface DuplicateIdentity {
  githubRepositoryId: string;
  count: number;
  repositoryIds: string[];
}

export interface RepositoryReconciliationReport {
  duplicates: DuplicateIdentity[];
  mergedRepositoryIds: string[];
  backfilledReviewIds: string[];
  applied: boolean;
}

type RawClient = Pick<Prisma.TransactionClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

/**
 * Preflight and reconcile legacy repository rows before githubRepositoryId is
 * made unique. Run once with --apply before db push, then once after db push
 * to backfill Review.repositoryId from version snapshots.
 */
export async function reconcileGithubRepositories(
  prisma: PrismaClient,
  apply: boolean,
): Promise<RepositoryReconciliationReport> {
  const duplicates = await findDuplicateIdentities(prisma);
  const mergedRepositoryIds: string[] = [];
  if (apply && duplicates.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const duplicate of duplicates) {
          const merged = await mergeIdentityGroup(tx, duplicate.githubRepositoryId);
          mergedRepositoryIds.push(...merged);
        }
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  }
  const backfilledReviewIds = apply ? await backfillReviewRepositories(prisma) : [];
  return { duplicates, mergedRepositoryIds, backfilledReviewIds, applied: apply };
}

async function findDuplicateIdentities(client: RawClient): Promise<DuplicateIdentity[]> {
  const groups = await client.$queryRawUnsafe<
    Array<{ githubRepositoryId: unknown; count: unknown }>
  >(
    `SELECT CAST(githubRepositoryId AS TEXT) AS githubRepositoryId, COUNT(*) AS count
       FROM Repository
      WHERE githubRepositoryId IS NOT NULL
      GROUP BY CAST(githubRepositoryId AS TEXT)
     HAVING COUNT(*) > 1
      ORDER BY CAST(githubRepositoryId AS TEXT)`,
  );
  const output: DuplicateIdentity[] = [];
  for (const group of groups) {
    const githubRepositoryId = String(group.githubRepositoryId);
    const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM Repository
        WHERE CAST(githubRepositoryId AS TEXT) = ?
        ORDER BY updatedAt DESC, createdAt DESC, id`,
      githubRepositoryId,
    );
    output.push({
      githubRepositoryId,
      count: Number(group.count),
      repositoryIds: rows.map((row) => row.id),
    });
  }
  return output;
}

async function mergeIdentityGroup(
  tx: Prisma.TransactionClient,
  githubRepositoryId: string,
): Promise<string[]> {
  const repositories = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM Repository
      WHERE CAST(githubRepositoryId AS TEXT) = ?
      ORDER BY updatedAt DESC, createdAt DESC, id`,
    githubRepositoryId,
  );
  const survivor = repositories[0]?.id;
  if (!survivor) return [];
  const merged: string[] = [];
  for (const loser of repositories.slice(1)) {
    await mergeRepository(tx, survivor, loser.id);
    merged.push(loser.id);
  }
  await mergeLegacyReviewsForRepository(tx, survivor);
  if (await tableExists(tx, "AuditEvent")) {
    const now = new Date().toISOString();
    await tx.$executeRawUnsafe(
      `INSERT INTO AuditEvent
         (id, action, subjectType, subjectId, detailsJson, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `repo-reconcile-${githubRepositoryId}-${Date.now()}`,
      "repository.identity-reconciled",
      "repository",
      survivor,
      JSON.stringify({ githubRepositoryId, mergedRepositoryIds: merged }),
      now,
    );
  }
  return merged;
}

async function mergeLegacyReviewsForRepository(
  tx: Prisma.TransactionClient,
  repositoryId: string,
): Promise<void> {
  if (!(await tableExists(tx, "Review")) || !(await tableExists(tx, "ReviewVersion"))) return;
  const reviews = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT DISTINCT r.id
       FROM Review r
       JOIN ReviewVersion v ON v.reviewId = r.id
       JOIN RepositorySnapshot s ON s.id = v.snapshotId
      WHERE s.repositoryId = ?
      ORDER BY r.id`,
    repositoryId,
  );
  const survivor = reviews[0]?.id;
  if (!survivor) return;
  for (const loser of reviews.slice(1)) {
    await updateIfTable(tx, "ReviewVersion", "reviewId", survivor, loser.id);
    await updateIfTable(tx, "ReviewComment", "reviewId", survivor, loser.id);
    await updateIfTable(tx, "Submission", "resultingReviewId", survivor, loser.id);
    await tx.$executeRawUnsafe("DELETE FROM Review WHERE id = ?", loser.id);
  }
}

async function mergeRepository(
  tx: Prisma.TransactionClient,
  survivorId: string,
  loserId: string,
): Promise<void> {
  const snapshots = await tx.$queryRawUnsafe<Array<{ id: string; commitSha: string }>>(
    "SELECT id, commitSha FROM RepositorySnapshot WHERE repositoryId = ? ORDER BY id",
    loserId,
  );
  for (const snapshot of snapshots) {
    const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      "SELECT id FROM RepositorySnapshot WHERE repositoryId = ? AND commitSha = ? LIMIT 1",
      survivorId,
      snapshot.commitSha,
    );
    if (existing[0]) {
      await updateIfTable(tx, "Submission", "snapshotId", existing[0].id, snapshot.id);
      await updateIfTable(tx, "ReviewVersion", "snapshotId", existing[0].id, snapshot.id);
      await updateIfTable(tx, "Review", "currentSnapshotId", existing[0].id, snapshot.id);
      await tx.$executeRawUnsafe("DELETE FROM RepositorySnapshot WHERE id = ?", snapshot.id);
    } else {
      await tx.$executeRawUnsafe(
        "UPDATE RepositorySnapshot SET repositoryId = ? WHERE id = ?",
        survivorId,
        snapshot.id,
      );
    }
  }
  await updateIfTable(tx, "Submission", "repositoryId", survivorId, loserId);
  if (await columnExists(tx, "Review", "repositoryId")) {
    const loserReviews = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      "SELECT id FROM Review WHERE repositoryId = ? ORDER BY id",
      loserId,
    );
    const survivorReview = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      "SELECT id FROM Review WHERE repositoryId = ? LIMIT 1",
      survivorId,
    );
    for (const review of loserReviews) {
      if (!survivorReview[0]) {
        await tx.$executeRawUnsafe(
          "UPDATE Review SET repositoryId = ? WHERE id = ?",
          survivorId,
          review.id,
        );
        survivorReview.push({ id: review.id });
      } else {
        await updateIfTable(tx, "ReviewVersion", "reviewId", survivorReview[0].id, review.id);
        await updateIfTable(tx, "ReviewComment", "reviewId", survivorReview[0].id, review.id);
        await updateIfTable(tx, "Submission", "resultingReviewId", survivorReview[0].id, review.id);
        await tx.$executeRawUnsafe("DELETE FROM Review WHERE id = ?", review.id);
      }
    }
  }
  await tx.$executeRawUnsafe("DELETE FROM Repository WHERE id = ?", loserId);
}

async function backfillReviewRepositories(prisma: PrismaClient): Promise<string[]> {
  if (!(await columnExists(prisma, "Review", "repositoryId"))) return [];
  const reviews = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT id FROM Review WHERE repositoryId IS NULL ORDER BY id",
  );
  const backfilled: string[] = [];
  for (const review of reviews) {
    const repositories = await prisma.$queryRawUnsafe<Array<{ repositoryId: string }>>(
      `SELECT DISTINCT s.repositoryId
         FROM ReviewVersion v
         JOIN RepositorySnapshot s ON s.id = v.snapshotId
        WHERE v.reviewId = ?`,
      review.id,
    );
    if (repositories.length === 1 && repositories[0]) {
      await prisma.$executeRawUnsafe(
        "UPDATE Review SET repositoryId = ? WHERE id = ?",
        repositories[0].repositoryId,
        review.id,
      );
      backfilled.push(review.id);
    } else if (repositories.length > 1) {
      throw new Error(
        `Legacy review '${review.id}' spans multiple repositories; reconcile manually.`,
      );
    }
  }
  return backfilled;
}

async function updateIfTable(
  client: RawClient,
  table: string,
  column: string,
  replacement: string,
  current: string,
): Promise<void> {
  if (!(await tableExists(client, table)) || !(await columnExists(client, table, column))) return;
  await client.$executeRawUnsafe(
    `UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`,
    replacement,
    current,
  );
}

async function tableExists(client: RawClient, table: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table,
  );
  return rows.length > 0;
}

async function columnExists(client: RawClient, table: string, column: string): Promise<boolean> {
  if (!(await tableExists(client, table))) return false;
  const rows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.some((row) => row.name === column);
}

async function main(): Promise<void> {
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) {
    throw new Error("This reconciliation command currently supports SQLite file databases only.");
  }
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const report = await reconcileGithubRepositories(prisma, apply);
    console.info(JSON.stringify(report, null, 2));
    if (!apply && report.duplicates.length > 0) {
      console.error("Duplicate GitHub repository ids found; rerun with --apply before db push.");
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
