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

const NODE_VERSION_SEMANTIC_FIELDS = [
  "title",
  "abstract",
  "text",
  "contributorsJson",
  "license",
  "provenanceJson",
  "payloadJson",
  "versionDoi",
  "conceptDoi",
  "isExample",
  "sourceSubmissionId",
  "inspectionCaptureId",
  "capturePayloadHash",
  "createdAt",
] as const;

const NODE_EDGE_SEMANTIC_FIELDS = [
  "status",
  "provenance",
  "rationale",
  "assertedAt",
  "confirmedTargetNodeVersionId",
  "confirmedById",
  "confirmedAt",
  "revision",
  "createdAt",
  "updatedAt",
] as const;

const NODE_ALIAS_SEMANTIC_FIELDS = ["isExample", "createdAt"] as const;

type NodeVersionSemanticRow = { id: string } & Record<
  (typeof NODE_VERSION_SEMANTIC_FIELDS)[number],
  unknown
>;
type NodeEdgeSemanticRow = { id: string } & Record<
  (typeof NODE_EDGE_SEMANTIC_FIELDS)[number],
  unknown
>;
type NodeAliasSemanticRow = { id: string } & Record<
  (typeof NODE_ALIAS_SEMANTIC_FIELDS)[number],
  unknown
>;

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
  await mergeKnowledgeNodes(tx, survivorId, loserId);
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
      await mergeKnowledgeNodeVersionsForSnapshot(tx, existing[0].id, snapshot.id);
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

async function mergeKnowledgeNodes(
  tx: Prisma.TransactionClient,
  survivorRepositoryId: string,
  loserRepositoryId: string,
): Promise<void> {
  if (!(await tableExists(tx, "KnowledgeNode"))) return;
  const loserNodes = await tx.$queryRawUnsafe<
    Array<{ id: string; localNodeId: string; kind: string }>
  >(
    "SELECT id, localNodeId, kind FROM KnowledgeNode WHERE repositoryId = ? ORDER BY id",
    loserRepositoryId,
  );
  for (const loserNode of loserNodes) {
    const existing = await tx.$queryRawUnsafe<Array<{ id: string; kind: string }>>(
      `SELECT id, kind FROM KnowledgeNode
        WHERE repositoryId = ? AND localNodeId = ? LIMIT 1`,
      survivorRepositoryId,
      loserNode.localNodeId,
    );
    if (!existing[0]) {
      await tx.$executeRawUnsafe(
        "UPDATE KnowledgeNode SET repositoryId = ? WHERE id = ?",
        survivorRepositoryId,
        loserNode.id,
      );
      continue;
    }

    const survivorNodeId = existing[0].id;
    if (existing[0].kind !== loserNode.kind) {
      throw new Error(
        `Cannot reconcile knowledge node '${loserNode.localNodeId}': kind mismatch ` +
          `('${existing[0].kind}' vs '${loserNode.kind}').`,
      );
    }
    await updateIfTable(
      tx,
      "KnowledgeNodeVersion",
      "knowledgeNodeId",
      survivorNodeId,
      loserNode.id,
    );
    await updateIfTable(tx, "Claim", "knowledgeNodeId", survivorNodeId, loserNode.id);
    await mergeNodeAliases(tx, survivorNodeId, loserNode.id);
    await mergeNodeEdgeTargets(tx, survivorNodeId, loserNode.id);
    await updateIfTable(tx, "NodeEdgeProposal", "targetNodeId", survivorNodeId, loserNode.id);
    await tx.$executeRawUnsafe("DELETE FROM KnowledgeNode WHERE id = ?", loserNode.id);
  }
}

async function mergeNodeAliases(
  tx: Prisma.TransactionClient,
  survivorNodeId: string,
  loserNodeId: string,
): Promise<void> {
  if (!(await tableExists(tx, "NodeAlias"))) return;
  const aliases = await tx.$queryRawUnsafe<
    Array<{ id: string; scheme: string; role: string; value: string }>
  >(
    `SELECT id, scheme, role, value FROM NodeAlias
      WHERE knowledgeNodeId = ? ORDER BY id`,
    loserNodeId,
  );
  for (const alias of aliases) {
    const duplicate = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM NodeAlias
        WHERE knowledgeNodeId = ? AND scheme = ? AND role = ? AND value = ? LIMIT 1`,
      survivorNodeId,
      alias.scheme,
      alias.role,
      alias.value,
    );
    if (duplicate[0]) {
      await assertNodeAliasesEquivalent(tx, duplicate[0].id, alias.id);
      await tx.$executeRawUnsafe("DELETE FROM NodeAlias WHERE id = ?", alias.id);
    } else {
      await tx.$executeRawUnsafe(
        "UPDATE NodeAlias SET knowledgeNodeId = ? WHERE id = ?",
        survivorNodeId,
        alias.id,
      );
    }
  }
}

async function mergeKnowledgeNodeVersionsForSnapshot(
  tx: Prisma.TransactionClient,
  survivorSnapshotId: string,
  loserSnapshotId: string,
): Promise<void> {
  if (!(await tableExists(tx, "KnowledgeNodeVersion"))) return;
  const versions = await tx.$queryRawUnsafe<Array<{ id: string; knowledgeNodeId: string }>>(
    `SELECT id, knowledgeNodeId FROM KnowledgeNodeVersion
      WHERE snapshotId = ? ORDER BY id`,
    loserSnapshotId,
  );
  for (const version of versions) {
    const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM KnowledgeNodeVersion
        WHERE knowledgeNodeId = ? AND snapshotId = ? LIMIT 1`,
      version.knowledgeNodeId,
      survivorSnapshotId,
    );
    if (existing[0]) {
      await assertKnowledgeNodeVersionsEquivalent(tx, existing[0].id, version.id);
      await updateIfTable(
        tx,
        "NodeEdge",
        "confirmedTargetNodeVersionId",
        existing[0].id,
        version.id,
      );
      await updateIfTable(
        tx,
        "NodeEdgeProposal",
        "sourceNodeVersionId",
        existing[0].id,
        version.id,
      );
      await updateIfTable(
        tx,
        "NodeEdgeProposal",
        "targetNodeVersionId",
        existing[0].id,
        version.id,
      );
      await mergeNodeEdgeSources(tx, existing[0].id, version.id);
      await tx.$executeRawUnsafe("DELETE FROM KnowledgeNodeVersion WHERE id = ?", version.id);
    } else {
      await tx.$executeRawUnsafe(
        "UPDATE KnowledgeNodeVersion SET snapshotId = ? WHERE id = ?",
        survivorSnapshotId,
        version.id,
      );
    }
  }
}

async function mergeNodeEdgeTargets(
  tx: Prisma.TransactionClient,
  survivorNodeId: string,
  loserNodeId: string,
): Promise<void> {
  if (!(await tableExists(tx, "NodeEdge"))) return;
  const edges = await tx.$queryRawUnsafe<
    Array<{ id: string; sourceNodeVersionId: string; relationType: string }>
  >(
    `SELECT id, sourceNodeVersionId, relationType FROM NodeEdge
      WHERE targetNodeId = ? ORDER BY id`,
    loserNodeId,
  );
  for (const edge of edges) {
    const duplicate = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM NodeEdge
        WHERE sourceNodeVersionId = ? AND targetNodeId = ? AND relationType = ? LIMIT 1`,
      edge.sourceNodeVersionId,
      survivorNodeId,
      edge.relationType,
    );
    if (duplicate[0]) {
      await assertNodeEdgesEquivalent(tx, duplicate[0].id, edge.id);
      await updateIfTable(tx, "NodeEdgeProposal", "confirmedEdgeId", duplicate[0].id, edge.id);
      await tx.$executeRawUnsafe("DELETE FROM NodeEdge WHERE id = ?", edge.id);
    } else {
      await tx.$executeRawUnsafe(
        "UPDATE NodeEdge SET targetNodeId = ? WHERE id = ?",
        survivorNodeId,
        edge.id,
      );
    }
  }
}

async function mergeNodeEdgeSources(
  tx: Prisma.TransactionClient,
  survivorVersionId: string,
  loserVersionId: string,
): Promise<void> {
  if (!(await tableExists(tx, "NodeEdge"))) return;
  const edges = await tx.$queryRawUnsafe<
    Array<{ id: string; targetNodeId: string; relationType: string }>
  >(
    `SELECT id, targetNodeId, relationType FROM NodeEdge
      WHERE sourceNodeVersionId = ? ORDER BY id`,
    loserVersionId,
  );
  for (const edge of edges) {
    const duplicate = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM NodeEdge
        WHERE sourceNodeVersionId = ? AND targetNodeId = ? AND relationType = ? LIMIT 1`,
      survivorVersionId,
      edge.targetNodeId,
      edge.relationType,
    );
    if (duplicate[0]) {
      await assertNodeEdgesEquivalent(tx, duplicate[0].id, edge.id);
      await updateIfTable(tx, "NodeEdgeProposal", "confirmedEdgeId", duplicate[0].id, edge.id);
      await tx.$executeRawUnsafe("DELETE FROM NodeEdge WHERE id = ?", edge.id);
    } else {
      await tx.$executeRawUnsafe(
        "UPDATE NodeEdge SET sourceNodeVersionId = ? WHERE id = ?",
        survivorVersionId,
        edge.id,
      );
    }
  }
}

async function assertKnowledgeNodeVersionsEquivalent(
  tx: Prisma.TransactionClient,
  survivorVersionId: string,
  loserVersionId: string,
): Promise<void> {
  const selectFields = NODE_VERSION_SEMANTIC_FIELDS.map((field) => `"${field}"`).join(", ");
  const rows = await tx.$queryRawUnsafe<NodeVersionSemanticRow[]>(
    `SELECT id, ${selectFields} FROM KnowledgeNodeVersion WHERE id IN (?, ?) ORDER BY id`,
    survivorVersionId,
    loserVersionId,
  );
  const survivor = rows.find((row) => row.id === survivorVersionId);
  const loser = rows.find((row) => row.id === loserVersionId);
  if (!survivor || !loser) {
    throw new Error("Cannot reconcile knowledge-node versions: a collision row disappeared.");
  }
  const differing = NODE_VERSION_SEMANTIC_FIELDS.filter(
    (field) => !semanticValuesEqual(survivor[field], loser[field]),
  );
  if (differing.length > 0) {
    throw new Error(
      `Cannot reconcile knowledge-node versions '${survivorVersionId}' and ` +
        `'${loserVersionId}': semantic fields differ (${differing.join(", ")}).`,
    );
  }
}

async function assertNodeEdgesEquivalent(
  tx: Prisma.TransactionClient,
  survivorEdgeId: string,
  loserEdgeId: string,
): Promise<void> {
  const selectFields = NODE_EDGE_SEMANTIC_FIELDS.map((field) => `"${field}"`).join(", ");
  const rows = await tx.$queryRawUnsafe<NodeEdgeSemanticRow[]>(
    `SELECT id, ${selectFields} FROM NodeEdge WHERE id IN (?, ?) ORDER BY id`,
    survivorEdgeId,
    loserEdgeId,
  );
  const survivor = rows.find((row) => row.id === survivorEdgeId);
  const loser = rows.find((row) => row.id === loserEdgeId);
  if (!survivor || !loser) {
    throw new Error("Cannot reconcile node edges: a collision row disappeared.");
  }
  const differing = NODE_EDGE_SEMANTIC_FIELDS.filter(
    (field) => !semanticValuesEqual(survivor[field], loser[field]),
  );
  if (differing.length > 0) {
    throw new Error(
      `Cannot reconcile node edges '${survivorEdgeId}' and '${loserEdgeId}': ` +
        `semantic fields differ (${differing.join(", ")}).`,
    );
  }
}

async function assertNodeAliasesEquivalent(
  tx: Prisma.TransactionClient,
  survivorAliasId: string,
  loserAliasId: string,
): Promise<void> {
  const selectFields = NODE_ALIAS_SEMANTIC_FIELDS.map((field) => `"${field}"`).join(", ");
  const rows = await tx.$queryRawUnsafe<NodeAliasSemanticRow[]>(
    `SELECT id, ${selectFields} FROM NodeAlias WHERE id IN (?, ?) ORDER BY id`,
    survivorAliasId,
    loserAliasId,
  );
  const survivor = rows.find((row) => row.id === survivorAliasId);
  const loser = rows.find((row) => row.id === loserAliasId);
  if (!survivor || !loser) {
    throw new Error("Cannot reconcile node aliases: a collision row disappeared.");
  }
  const differing = NODE_ALIAS_SEMANTIC_FIELDS.filter(
    (field) => !semanticValuesEqual(survivor[field], loser[field]),
  );
  if (differing.length > 0) {
    throw new Error(
      `Cannot reconcile node aliases '${survivorAliasId}' and '${loserAliasId}': ` +
        `semantic fields differ (${differing.join(", ")}).`,
    );
  }
}

function semanticValuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return Object.is(left, right);
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
