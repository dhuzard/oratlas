import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  publicGraphQuerySchema,
  publicGraphResponseSchema,
} from "@oratlas/contracts";
import type { PrismaClient } from "@oratlas/db";
import type * as GraphQuery from "./graph-query";

vi.mock("server-only", () => ({}));

const fileName = `.tmp-oratlas-graph-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = `file:./${fileName}`;

let prisma: PrismaClient;
let graph: typeof GraphQuery;
let sourceNodeId: string;
let targetNodeId: string;
let confirmedContradictionId: string;
let proposedEdgeId: string;

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
    // Some Windows Prisma engines fail `db push` before returning diagnostics.
    // Generate the same schema DDL and feed it to the system SQLite CLI so this
    // seeded test remains runnable; CI's normal engine path stays authoritative.
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
  graph = await import("./graph-query");

  const repository = await prisma.repository.create({
    data: {
      owner: "graph-lab",
      name: "public-graph",
      canonicalUrl: "https://github.com/graph-lab/public-graph",
    },
  });
  const editor = await prisma.user.create({
    data: { githubUserId: "graph-editor", githubLogin: "graph-editor", role: "EDITOR" },
  });
  const source = await createNode(repository.id, "source-claim", "claim", "a", {
    statement: "Memory replay supports consolidation.",
    qualifiers: [],
  });
  const target = await createNode(repository.id, "target-dataset", "dataset", "b", {
    artifactPath: "data/replay.csv",
    format: "text/csv",
    sizeBytes: 1024,
    doi: "10.1234/replay.data",
  });
  const code = await createNode(repository.id, "analysis-code", "code", "c", {
    entryPoints: ["src/analyse.py"],
    language: "Python",
    releaseRef: "v1.0.0",
  });
  sourceNodeId = source.nodeId;
  targetNodeId = target.nodeId;

  const review = await prisma.review.create({
    data: {
      repositoryId: repository.id,
      currentSnapshotId: source.snapshotId,
      slug: "graph-review",
      title: "Graph review",
      status: "published",
    },
  });
  const reviewVersion = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: source.snapshotId,
      title: "Graph review",
      metadataJson: "{}",
      publicState: "published",
    },
  });
  const claim = await prisma.claim.create({
    data: {
      reviewVersionId: reviewVersion.id,
      knowledgeNodeId: source.nodeId,
      localClaimId: "source-claim",
      text: "Memory replay supports consolidation.",
      normalizedText: "memory replay supports consolidation",
    },
  });
  const citation = await prisma.citation.create({
    data: { reviewVersionId: reviewVersion.id, localCitationId: "ref-1", title: "Replay data" },
  });
  const evidence = await prisma.claimEvidenceRelation.create({
    data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
  });
  await prisma.trustAssessment.create({
    data: {
      claimEvidenceRelationId: evidence.id,
      protocolVersion: "TRUST-1.0",
      assessorType: "agent",
    },
  });

  const confirmed = await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: source.versionId,
      targetNodeId: target.nodeId,
      relationType: "contradicts",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      rationale: "The dataset conflicts with the claim.",
      confirmedTargetNodeVersionId: target.versionId,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-03-01T00:00:00Z"),
    },
  });
  confirmedContradictionId = confirmed.id;
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: target.versionId,
      targetNodeId: code.nodeId,
      relationType: "uses-code",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: code.versionId,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-03-02T00:00:00Z"),
    },
  });

  const proposed = await prisma.nodeEdgeProposal.create({
    data: {
      originKey: "agent:public-proposal",
      sourceStableKey: `node:${target.nodeId}`,
      targetStableKey: `node:${code.nodeId}`,
      sourceNodeVersionId: target.versionId,
      targetNodeId: code.nodeId,
      targetNodeVersionId: code.versionId,
      relationType: "derives-from",
      origin: "proposed-by-agent",
      rationale: "Safe public rationale.",
      evidenceJson: canonicalJson({ secretPrompt: "never expose this", token: "private-token" }),
      status: "proposed",
    },
  });
  proposedEdgeId = proposed.id;
  await prisma.nodeEdgeProposal.create({
    data: {
      originKey: "agent:rejected-proposal",
      sourceStableKey: `node:${source.nodeId}`,
      targetStableKey: `node:${code.nodeId}`,
      sourceNodeVersionId: source.versionId,
      targetNodeId: code.nodeId,
      targetNodeVersionId: code.versionId,
      relationType: "supports",
      origin: "proposed-by-agent",
      rationale: "Rejected rationale must remain private.",
      evidenceJson: canonicalJson({ secretPrompt: "also private" }),
      status: "rejected",
      reviewedById: editor.id,
      reviewedAt: new Date("2026-03-03T00:00:00Z"),
      reviewNote: "private editorial note",
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

describe.sequential("public graph query", () => {
  it("traverses contradictions symmetrically without changing their canonical direction or id", async () => {
    const fromSource = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: sourceNodeId, depth: 1 }),
    );
    const fromTarget = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: targetNodeId, depth: 1 }),
    );
    for (const result of [fromSource, fromTarget]) {
      expect(publicGraphResponseSchema.parse(result)).toEqual(result);
      const contradictions = result.edges.filter((edge) => edge.relationType === "contradicts");
      expect(contradictions).toHaveLength(1);
      expect(contradictions[0]).toMatchObject({
        id: confirmedContradictionId,
        sourceNodeId,
        targetNodeId,
        status: "confirmed",
      });
    }
  });

  it("paginates deterministic confirmed edges with a query-bound cursor", async () => {
    const first = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: targetNodeId, depth: 1, limit: 1 }),
    );
    expect(first.edges).toHaveLength(1);
    expect(first.page.nextCursor).toBeTruthy();
    const second = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({
        seed: targetNodeId,
        depth: 1,
        limit: 1,
        cursor: first.page.nextCursor,
      }),
    );
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0]?.id).not.toBe(first.edges[0]?.id);
    await expect(
      graph.queryPublicGraph(
        publicGraphQuerySchema.parse({
          seed: targetNodeId,
          depth: 2,
          limit: 1,
          cursor: first.page.nextCursor,
        }),
      ),
    ).rejects.toThrow("invalid for this query");
  });

  it("searches topic seeds and exposes exact version provenance and identifiers", async () => {
    const result = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ q: "memory consolidation", depth: 0 }),
    );
    expect(result.seedNodeIds).toEqual([sourceNodeId]);
    expect(result.nodes[0]).toMatchObject({
      id: sourceNodeId,
      provenance: { sourcePath: "nodes/source-claim.json" },
    });
    expect(result.nodes[0]?.identifiers).toEqual([]);
  });

  it("returns only privacy-minimal proposed edges and never rejected proposals", async () => {
    const result = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: targetNodeId, edgeStatus: "proposed", depth: 1 }),
    );
    expect(result.edges).toEqual([
      expect.objectContaining({
        id: proposedEdgeId,
        status: "proposed",
        provenance: "proposed-by-agent",
        rationale: "Safe public rationale.",
      }),
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "secretPrompt",
      "private-token",
      "Rejected rationale",
      "private editorial note",
      "reviewedById",
      "evidenceJson",
      "agentRun",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("applies relation, kind, and TRUST-presence filters without orphan endpoints", async () => {
    const relation = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: targetNodeId, relationType: "uses-code", depth: 1 }),
    );
    expect(relation.edges.map((edge) => edge.relationType)).toEqual(["uses-code"]);
    const kind = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: targetNodeId, kind: "dataset", depth: 1 }),
    );
    expect(kind.edges).toEqual([]);
    expect(kind.nodes.every((node) => node.kind === "dataset")).toBe(true);
    const trust = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: targetNodeId, hasTrust: true, depth: 1 }),
    );
    expect(trust.nodes).toEqual([]);
    expect(trust.edges).toEqual([]);
    const trustedSource = await graph.queryPublicGraph(
      publicGraphQuerySchema.parse({ seed: sourceNodeId, hasTrust: true, depth: 0 }),
    );
    expect(trustedSource.nodes).toEqual([
      expect.objectContaining({ id: sourceNodeId, hasTrust: true }),
    ]);
  });
});

async function createNode(
  repositoryId: string,
  localNodeId: string,
  kind: string,
  shaChar: string,
  payload: unknown,
) {
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId,
      commitSha: shaChar.repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: shaChar.repeat(64),
    },
  });
  const node = await prisma.knowledgeNode.create({ data: { repositoryId, localNodeId, kind } });
  const version = await prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: node.id,
      snapshotId: snapshot.id,
      title: localNodeId.replaceAll("-", " "),
      abstract: kind === "claim" ? "Memory consolidation from replay." : undefined,
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({ sourcePath: `nodes/${localNodeId}.json` }),
      payloadJson: canonicalJson(payload),
      createdAt: new Date(`2026-01-0${shaChar.charCodeAt(0) - 96}T00:00:00Z`),
    },
  });
  return { nodeId: node.id, versionId: version.id, snapshotId: snapshot.id };
}
