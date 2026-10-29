/**
 * Synthetic SQLite benchmark for #248. Run from the repository root:
 * pnpm exec tsx scripts/benchmark-canonical-materialization.ts
 * Never reads the configured DATABASE_URL. Its temporary database is removed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "../packages/db/generated/client/index.js";
import { applyDatabaseGuards } from "../packages/db/src/database-guards.js";
import { materializeCanonicalReviewGraph } from "../packages/db/src/canonical-graph-materialization.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "oratlas-materialization-248-"));
const databasePath = join(directory, "synthetic.db");
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
const counts = { claims: 529, citations: 994, relations: 1392 };
const prisma = new PrismaClient({
  datasourceUrl: databaseUrl,
  log: [{ emit: "event", level: "query" }],
});
let queries = 0;
let databaseMilliseconds = 0;
prisma.$on("query", (event) => {
  queries += 1;
  databaseMilliseconds += event.duration;
});

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let offset = 0; offset < rows.length; offset += 50) {
    await insert(rows.slice(offset, offset + 50));
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const cli = resolve(
    dirname(require.resolve("prisma/package.json", { paths: [join(root, "packages/db")] })),
    "build/index.js",
  );
  const schema = join(root, "packages/db/prisma/schema.prisma");
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  try {
    execFileSync(process.execPath, [cli, "db", "push", "--schema", schema, "--skip-generate"], {
      cwd: root,
      env,
      stdio: "pipe",
    });
  } catch (error) {
    // Same Windows schema-engine fallback as the SQLite integration suite.
    if (process.platform !== "win32") throw error;
    const ddl = execFileSync(
      process.execPath,
      [cli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"],
      { cwd: root, env, encoding: "utf8" },
    );
    execFileSync("sqlite3", [databasePath], { input: ddl, stdio: "pipe" });
  }
  await applyDatabaseGuards(prisma, "sqlite");
  const repository = await prisma.repository.create({
    data: {
      owner: "synthetic-benchmark",
      name: "issue-248",
      canonicalUrl: "https://github.com/synthetic-benchmark/issue-248",
      githubRepositoryId: "synthetic-benchmark-248",
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
      slug: "synthetic-benchmark-248",
      title: "Synthetic materialization benchmark",
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
      licenseSpdx: "CC0-1.0",
    },
  });
  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: review.title,
      metadataJson: "{}",
      isExample: true,
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    },
  });
  await insertChunks(
    Array.from({ length: counts.claims }, (_, index) => ({
      id: `benchmark-claim-${String(index).padStart(4, "0")}`,
      reviewVersionId: version.id,
      localClaimId: `claim-${index}`,
      text: `Synthetic claim ${index}.`,
      normalizedText: `synthetic claim ${index}.`,
    })),
    (data) => prisma.claim.createMany({ data }),
  );
  await insertChunks(
    Array.from({ length: counts.citations }, (_, index) => ({
      id: `benchmark-citation-${String(index).padStart(4, "0")}`,
      reviewVersionId: version.id,
      localCitationId: `citation-${index}`,
      doi: `10.5555/benchmark-${index}`,
      title: `Synthetic cited work ${index}`,
      authorsJson: '["Synthetic Author"]',
    })),
    (data) => prisma.citation.createMany({ data }),
  );
  await insertChunks(
    Array.from({ length: counts.relations }, (_, index) => ({
      id: `benchmark-relation-${String(index).padStart(4, "0")}`,
      claimId: `benchmark-claim-${String(index % counts.claims).padStart(4, "0")}`,
      citationId: `benchmark-citation-${String(index % counts.citations).padStart(4, "0")}`,
      relationType: "supports",
    })),
    (data) => prisma.claimEvidenceRelation.createMany({ data }),
  );
  for (const phase of ["first", "replay"]) {
    queries = 0;
    databaseMilliseconds = 0;
    const started = performance.now();
    const report = await prisma.$transaction(
      (tx) => materializeCanonicalReviewGraph(tx, version.id),
      {
        isolationLevel: "Serializable",
        timeout: 600_000,
      },
    );
    const wallMilliseconds = Math.round(performance.now() - started);
    if (
      report.claimCount !== counts.claims ||
      report.workCount !== counts.citations ||
      report.evidenceEdgeCount !== counts.relations
    ) {
      throw new Error("Materialization report disagrees with synthetic fixture counts.");
    }
    process.stdout.write(
      `${JSON.stringify({ provider: "sqlite", synthetic: true, phase, ...counts, queries, wallMilliseconds, databaseMilliseconds })}\n`,
    );
  }
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
    rmdirSync(directory);
  });
