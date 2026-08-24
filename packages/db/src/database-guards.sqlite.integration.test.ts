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

describe("SQLite database guards", () => {
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

  it("accepts canonical work identity and rejects incomplete source unions", async () => {
    const suffix = `${Date.now()}`;
    const work = await prisma.knowledgeNode.create({
      data: {
        stableKey: `work:doi:10.1000/${suffix}`,
        originType: "canonical-work",
        localNodeId: `work-${suffix}`,
        kind: "work",
      },
    });
    expect(work.repositoryId).toBeNull();

    await expect(
      prisma.knowledgeNode.create({
        data: {
          originType: "repository-object",
          localNodeId: `invalid-${suffix}`,
          kind: "claim",
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: work.id,
          title: "Missing exact source",
          contributorsJson: "[]",
          license: "CC0-1.0",
          provenanceJson: "{}",
          payloadJson: "{}",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects certification supersession across a different subject, certifier, or protocol", async () => {
    const packetHash = "a".repeat(64);
    const resultHash = "b".repeat(64);
    for (const [runId, versionId, certifierId, protocolId] of [
      ["guard-run-a", "version-a", "certifier-a", "protocol-a"],
      ["guard-run-b", "version-b", "certifier-b", "protocol-b"],
    ])
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CertificationRun"
          ("id", "publicationVersionId", "certifierId", "protocolId", "assessmentMode", "status",
           "idempotencyKey", "inputPacketJson", "inputPacketSha256", "packetSchemaVersion",
           "completenessJson", "capturedAt", "createdAt")
        VALUES
          ('${runId}', '${versionId}', '${certifierId}', '${protocolId}', 'human', 'running',
           '${runId}', '{}', '${packetHash}', '1.1.0', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CertificationResult"
        ("id", "certificationRunId", "publicationVersionId", "certifierId", "protocolId",
         "inputPacketSha256", "assessmentMode", "criteriaJson", "outcome", "limitationsJson",
         "conflictOfInterestJson", "independenceJson", "provenanceJson", "resultJson",
         "resultSha256", "issuedAt", "createdAt")
      VALUES
        ('guard-result-a', 'guard-run-a', 'version-a', 'certifier-a', 'protocol-a',
         '${packetHash}', 'human', '[]', 'certified', '[]', '{}', '{}', '{}', '{}',
         '${resultHash}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "CertificationResult"
          ("id", "certificationRunId", "publicationVersionId", "certifierId", "protocolId",
           "inputPacketSha256", "assessmentMode", "criteriaJson", "outcome", "limitationsJson",
           "conflictOfInterestJson", "independenceJson", "provenanceJson", "resultJson",
           "resultSha256", "supersedesResultId", "issuedAt", "createdAt")
        VALUES
          ('guard-result-b', 'guard-run-b', 'version-b', 'certifier-b', 'protocol-b',
           '${packetHash}', 'human', '[]', 'certified', '[]', '{}', '{}', '{}', '{}',
           '${resultHash}', 'guard-result-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `),
    ).rejects.toThrow();
  });
});
