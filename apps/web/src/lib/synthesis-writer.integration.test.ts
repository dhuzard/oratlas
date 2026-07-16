import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";
import { canonicalJson, type SubgraphEvidenceSource } from "@oratlas/contracts";
import {
  buildPreparedSubgraphEvidencePacket,
  fingerprintSubgraphEvidenceSelection,
  SYNTHESIS_FALLBACK_MODEL,
  SYNTHESIS_FALLBACK_PROVIDER,
  SYNTHESIS_PROMPT_HASH,
  type LlmProvider,
} from "@oratlas/knowledge";
import type * as WriterService from "./synthesis-writer";

vi.mock("server-only", () => ({}));

const fileName = `.tmp-oratlas-synthesis-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = `file:./${fileName}`;
let prisma: PrismaClient;
let service: typeof WriterService;

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
  service = await import("./synthesis-writer");
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
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || attempt === 5) break;
        if (process.platform !== "win32" || (code !== "EPERM" && code !== "EBUSY")) throw error;
        await delay(25 * 2 ** attempt);
      }
    }
  }
});

function prepared() {
  const commitSha = "a".repeat(40);
  const selection = { kind: "seed" as const, nodeId: "claim", versionId: "claim-v1" };
  const source: SubgraphEvidenceSource = {
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: { nodeCount: 1, edgeCount: 0, contradictionEdgeIds: [] },
    nodes: [
      {
        id: "claim",
        localNodeId: "claim",
        repository: { owner: "atlas", name: "review", url: "https://github.com/atlas/review" },
        versionId: "claim-v1",
        snapshotId: "snapshot-v1",
        commitSha,
        title: "A grounded claim",
        contributors: [{ displayName: "Reviewer" }],
        license: "CC-BY-4.0",
        provenance: {
          sourcePath: "knowledge/claim.json",
          repositoryUrl: "https://github.com/atlas/review",
          commitSha,
        },
        identifiers: [
          { scheme: "doi", role: "version-doi", value: "10.1234/CLAIM", isExample: false },
        ],
        isExample: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "claim",
        payload: { statement: "A grounded claim.", qualifiers: [] },
      },
    ],
    edges: [],
  };
  return buildPreparedSubgraphEvidencePacket(source);
}

describe.sequential("Prisma synthesis run recorder", () => {
  it("persists a deterministic run start and validated success before return", async () => {
    const packet = prepared();
    const result = await service.generateSynthesisReview(packet, undefined, prisma);
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({
      agentType: "synthesis-review",
      modelProvider: SYNTHESIS_FALLBACK_PROVIDER,
      modelName: SYNTHESIS_FALLBACK_MODEL,
      promptHash: SYNTHESIS_PROMPT_HASH,
      packetHash: packet.sha256,
      inputHash: packet.sha256,
      inputReferencesJson: packet.json,
      status: "succeeded",
      error: null,
    });
    expect(run.completedAt).toBeInstanceOf(Date);
    expect(run.outputJson).toBe(canonicalJson(result.document));
    expect(run.outputJson).not.toContain("AgentRun");
  });

  it("persists a sanitized provider failure without rejected output or fallback", async () => {
    const packet = prepared();
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-model",
      async complete() {
        return "rejected raw secret";
      },
    };
    await expect(service.generateSynthesisReview(packet, provider, prisma)).rejects.toMatchObject({
      code: "malformed-json",
    });
    const run = await prisma.agentRun.findFirstOrThrow({
      where: { modelProvider: "mock" },
      orderBy: { startedAt: "desc" },
    });
    expect(run.status).toBe("failed");
    expect(run.outputJson).toBeNull();
    expect(run.error).toBe("malformed-json: Model output was not valid JSON.");
    expect(JSON.stringify(run)).not.toContain("rejected raw secret");
  });
});
