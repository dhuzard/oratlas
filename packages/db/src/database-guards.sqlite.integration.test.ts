import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client/index.js";
import { applyDatabaseGuards } from "./database-guards.js";

const databasePath = join(tmpdir(), `oratlas-decision-guards-${process.pid}-${Date.now()}.db`);
// Keep PRAGMA state and the raw fixture writes on one SQLite connection.
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}?connection_limit=1`;
let prisma: PrismaClient;

describe("SQLite immutable editorial decision guards", () => {
  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--schema",
        resolve(process.cwd(), "packages/db/prisma/schema.prisma"),
        "--skip-generate",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
    );
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await applyDatabaseGuards(prisma, "sqlite");
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "DecisionLetter"
        ("id", "roundId", "editorId", "decision", "bodyJson", "bodyHash",
         "conflictOfInterestStatus", "administratorOverride", "createdAt")
      VALUES
        ('letter-guard', 'round-guard', 'editor-guard', 'accept', '{}', 'body-hash',
         'not-provided', 0, CURRENT_TIMESTAMP)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "EditorialDecisionProvenance"
        ("id", "submissionId", "actorId", "actorGithubLoginSnapshot", "actorRoleSnapshot",
         "decision", "decisionHash", "conflictOfInterestStatus", "administratorOverride", "createdAt")
      VALUES
        ('direct-guard', 'submission-guard', 'editor-guard', 'editor-snapshot', 'EDITOR',
         'accept', 'decision-hash', 'not-provided', 0, CURRENT_TIMESTAMP)
    `);
  }, 30_000);

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

  it.each(["DecisionLetter", "EditorialDecisionProvenance"])(
    "rejects updates and deletion of %s rows",
    async (table) => {
      await expect(
        prisma.$executeRawUnsafe(`UPDATE "${table}" SET "decision" = 'reject'`),
      ).rejects.toThrow("Editorial decision provenance is immutable");
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(
        "Editorial decision provenance is immutable",
      );
    },
  );
});
