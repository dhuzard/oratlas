import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
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
const CURSOR_SECRET = "kg08-integration-cursor-secret";

let prisma: PrismaClient;
let graph: typeof GraphQuery;
let sourceNodeId: string;
let targetNodeId: string;
let confirmedContradictionId: string;
let confirmedUsesCodeId: string;
let proposedEdgeId: string;
let repositoryId: string;
let editorId: string;
let sourceVersionId: string;
let targetVersionId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = CURSOR_SECRET;
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
  repositoryId = repository.id;
  editorId = editor.id;
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
  sourceVersionId = source.versionId;
  targetVersionId = target.versionId;

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
  for (const [snapshotId, title] of [
    [target.snapshotId, "Graph review dataset"],
    [code.snapshotId, "Graph review code"],
  ] as const) {
    await prisma.reviewVersion.create({
      data: {
        reviewId: review.id,
        snapshotId,
        title,
        metadataJson: "{}",
        publicState: "published",
      },
    });
  }
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
  const usesCode = await prisma.nodeEdge.create({
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
  confirmedUsesCodeId = usesCode.id;

  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: source.versionId,
      targetNodeId: code.nodeId,
      relationType: "invalid-private-relation",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: code.versionId,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-03-02T12:00:00Z"),
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
      originKey: "agent:invalid-public-proposal",
      sourceStableKey: `node:${target.nodeId}`,
      targetStableKey: `node:${source.nodeId}`,
      sourceNodeVersionId: target.versionId,
      targetNodeId: source.nodeId,
      targetNodeVersionId: source.versionId,
      relationType: "supports",
      origin: "private-origin",
      rationale: "Invalid stored projection.",
      status: "proposed",
    },
  });
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

async function query(
  input: Parameters<typeof publicGraphQuerySchema.parse>[0],
  trustProvider: GraphQuery.GraphTrustProvider = graph.emptyGraphTrustProvider,
  cursorSecret = CURSOR_SECRET,
) {
  return graph.queryPublicGraph(publicGraphQuerySchema.parse(input), {
    cursorSecret,
    trustProvider,
  });
}

describe.sequential("public graph query", () => {
  it("traverses contradictions symmetrically without changing their canonical direction or id", async () => {
    const fromSource = await query({ seed: sourceNodeId, depth: 1 });
    const fromTarget = await query({ seed: targetNodeId, depth: 1 });
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

  it("uses a signed mutation-sensitive keyset cursor", async () => {
    const first = await query({ seed: targetNodeId, depth: 1, limit: 1 });
    expect(first.edges).toHaveLength(1);
    expect(first.page.nextCursor).toBeTruthy();
    const second = await query({
      seed: targetNodeId,
      depth: 1,
      limit: 1,
      cursor: first.page.nextCursor,
    });
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0]?.id).not.toBe(first.edges[0]?.id);
    await expect(
      query({
        seed: targetNodeId,
        depth: 2,
        limit: 1,
        cursor: first.page.nextCursor,
      }),
    ).rejects.toThrow("invalid, stale");

    const cursor = first.page.nextCursor!;
    const replacement = cursor.endsWith("a") ? "b" : "a";
    await expect(
      query({ seed: targetNodeId, depth: 1, limit: 1, cursor: cursor.slice(0, -1) + replacement }),
    ).rejects.toThrow("invalid, stale");

    await prisma.nodeEdge.update({
      where: { id: confirmedUsesCodeId },
      data: { rationale: "Candidate mutation invalidates old cursors." },
    });
    await expect(query({ seed: targetNodeId, depth: 1, limit: 1, cursor })).rejects.toThrow(
      "invalid, stale",
    );
    await prisma.nodeEdge.update({
      where: { id: confirmedUsesCodeId },
      data: { rationale: null },
    });
  });

  it("rejects canonical and noncanonical final-character signature mutations", async () => {
    const first = await query({ seed: targetNodeId, depth: 1, limit: 1 });
    const template = first.page.nextCursor!;
    const separator = template.lastIndexOf(".");
    const payload = template.slice(0, separator);
    const secretsByEnding = new Map<string, string>();

    // The final character of an unpadded 32-byte base64url value is one of
    // A/Q/g/w. Fixed candidate secrets make this exhaustive and repeatable.
    for (let index = 0; index < 256 && secretsByEnding.size < 4; index += 1) {
      const secret = `kg08-canonical-signature-${index}`;
      const signature = createHmac("sha256", secret).update(payload).digest("base64url");
      const ending = signature.at(-1)!;
      if (["A", "Q", "g", "w"].includes(ending)) secretsByEnding.set(ending, secret);
    }
    expect([...secretsByEnding.keys()].sort()).toEqual(["A", "Q", "g", "w"].sort());

    const unusedBitMutation: Record<string, string> = { A: "B", Q: "R", g: "h", w: "x" };
    const significantBitMutation: Record<string, string> = { A: "Q", Q: "g", g: "w", w: "A" };
    for (const ending of ["A", "Q", "g", "w"]) {
      const secret = secretsByEnding.get(ending)!;
      const signature = createHmac("sha256", secret).update(payload).digest("base64url");
      expect(signature).toHaveLength(43);
      expect(signature.endsWith(ending)).toBe(true);
      const canonicalCursor = `${payload}.${signature}`;
      await expect(
        query(
          { seed: targetNodeId, depth: 1, limit: 1, cursor: canonicalCursor },
          graph.emptyGraphTrustProvider,
          secret,
        ),
      ).resolves.toMatchObject({ edges: [expect.any(Object)] });

      for (const replacement of [unusedBitMutation[ending]!, significantBitMutation[ending]!]) {
        const mutated = `${payload}.${signature.slice(0, -1)}${replacement}`;
        await expect(
          query(
            { seed: targetNodeId, depth: 1, limit: 1, cursor: mutated },
            graph.emptyGraphTrustProvider,
            secret,
          ),
        ).rejects.toThrow("invalid, stale");
      }
    }
  });

  it("searches topic seeds and exposes authoritative snapshot and commit identity", async () => {
    const result = await query({ q: "memory consolidation", depth: 0 });
    expect(result.seedNodeIds).toEqual([sourceNodeId]);
    expect(result.nodes[0]).toMatchObject({
      id: sourceNodeId,
      versionId: sourceVersionId,
      snapshotId: expect.any(String),
      commitSha: "a".repeat(40),
      provenance: { sourcePath: "nodes/source-claim.json" },
    });
    expect(result.nodes[0]?.identifiers).toEqual([]);
  });

  it("safe-parses stored rows and returns only privacy-minimal valid proposals", async () => {
    const result = await query({ seed: targetNodeId, edgeStatus: "proposed", depth: 1 });
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
      "Invalid stored projection",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const confirmed = await query({ seed: sourceNodeId, depth: 1 });
    expect(JSON.stringify(confirmed.edges)).not.toContain("invalid-private-relation");
  });

  it("applies relation and kind filters without orphan endpoints", async () => {
    const relation = await query({ seed: targetNodeId, relationType: "uses-code", depth: 1 });
    expect(relation.edges.map((edge) => edge.relationType)).toEqual(["uses-code"]);
    const kind = await query({ seed: targetNodeId, kind: "dataset", depth: 1 });
    expect(kind.edges).toEqual([]);
    expect(kind.nodes.every((node) => node.kind === "dataset")).toBe(true);
  });

  it("keeps TRUST exact-edge scoped behind the provider override", async () => {
    const defaultResult = await query({ seed: sourceNodeId, depth: 1 });
    expect(defaultResult.nodes.every((node) => !("hasTrust" in node))).toBe(true);
    expect(defaultResult.edges.every((edge) => !("trust" in edge))).toBe(true);
    expect((await query({ seed: sourceNodeId, depth: 1, hasTrust: true })).edges).toEqual([]);

    const expectedKey = graph.graphTrustLookupKey({
      sourceVersionId,
      targetVersionId,
      relationType: "contradicts",
    });
    const provider: GraphQuery.GraphTrustProvider = {
      async lookup(keys) {
        expect(keys).toContainEqual({
          sourceVersionId,
          targetVersionId,
          relationType: "contradicts",
        });
        return new Map([
          [
            expectedKey,
            {
              protocolVersion: "TRUST-1.0",
              reviewStatus: "human-reviewed",
              verificationState: "platform-verified",
              conflictOfInterest: { status: "not-provided" },
            },
          ],
          [
            graph.graphTrustLookupKey({
              sourceVersionId: targetVersionId,
              targetVersionId:
                keys.find((key) => key.relationType === "uses-code")?.targetVersionId ?? "missing",
              relationType: "uses-code",
            }),
            { protocolVersion: "bad", reviewStatus: "private-invalid" },
          ],
        ]);
      },
    };
    const trusted = await query({ seed: sourceNodeId, depth: 1, hasTrust: true }, provider);
    expect(trusted.edges).toEqual([
      expect.objectContaining({
        id: confirmedContradictionId,
        trust: {
          protocolVersion: "TRUST-1.0",
          reviewStatus: "human-reviewed",
          verificationState: "platform-verified",
          conflictOfInterest: { status: "not-provided" },
        },
      }),
    ]);
    expect(JSON.stringify(trusted.nodes)).not.toContain("trust");

    const proposed = await query(
      { seed: targetNodeId, edgeStatus: "proposed", hasTrust: false, depth: 1 },
      provider,
    );
    expect(proposed.edges).toHaveLength(1);
    expect(proposed.edges.every((edge) => !("trust" in edge))).toBe(true);
    expect(
      (
        await query(
          { seed: targetNodeId, edgeStatus: "proposed", hasTrust: true, depth: 1 },
          provider,
        )
      ).edges,
    ).toEqual([]);
  });

  it("withholds graph nodes and edges until one readable published review authorizes their snapshot", async () => {
    const hidden = await createNode(repositoryId, "hidden-graph-target", "claim", "f", {
      statement: "This graph node is not public without snapshot authority.",
      qualifiers: [],
    });
    const hiddenEdge = await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId: sourceVersionId,
        targetNodeId: hidden.nodeId,
        relationType: "supports",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedTargetNodeVersionId: hidden.versionId,
        confirmedById: editorId,
        confirmedAt: new Date("2026-03-10T00:00:00Z"),
      },
    });
    const assertHidden = async () => {
      await expect(query({ seed: hidden.nodeId, depth: 0 })).rejects.toMatchObject({
        code: "not-found",
      });
      const fromPublicSource = await query({ seed: sourceNodeId, depth: 1 });
      expect(fromPublicSource.nodes.map((node) => node.id)).not.toContain(hidden.nodeId);
      expect(fromPublicSource.edges.map((edge) => edge.id)).not.toContain(hiddenEdge.id);
    };

    await assertHidden();

    const nodeOnlySubmission = await prisma.submission.create({
      data: {
        submitterId: editorId,
        repositoryId,
        snapshotId: hidden.snapshotId,
        status: "accepted",
        acceptedNodeSelectionJson: canonicalJson(["hidden-graph-target"]),
      },
    });
    await prisma.knowledgeNodeVersion.update({
      where: { id: hidden.versionId },
      data: { sourceSubmissionId: nodeOnlySubmission.id },
    });
    const nodeOnlyVisible = await query({ seed: sourceNodeId, depth: 1 });
    expect(nodeOnlyVisible.nodes.map((node) => node.id)).toContain(hidden.nodeId);
    expect(nodeOnlyVisible.edges.map((edge) => edge.id)).toContain(hiddenEdge.id);

    const tombstonedReview = await prisma.review.create({
      data: { slug: "graph-hidden-tombstoned", title: "Hidden graph", status: "published" },
    });
    const tombstonedVersion = await prisma.reviewVersion.create({
      data: {
        reviewId: tombstonedReview.id,
        snapshotId: hidden.snapshotId,
        title: "Hidden graph",
        metadataJson: "{}",
        publicState: "tombstoned",
      },
    });
    await prisma.submission.update({
      where: { id: nodeOnlySubmission.id },
      data: { resultingReviewVersionId: tombstonedVersion.id },
    });
    await assertHidden();

    const readableReview = await prisma.review.create({
      data: { slug: "graph-hidden-readable", title: "Readable graph", status: "published" },
    });
    const readableVersion = await prisma.reviewVersion.create({
      data: {
        reviewId: readableReview.id,
        snapshotId: hidden.snapshotId,
        title: "Readable graph",
        metadataJson: "{}",
        publicState: "published",
      },
    });
    const visible = await query({ seed: sourceNodeId, depth: 1 });
    expect(visible.nodes.map((node) => node.id)).toContain(hidden.nodeId);
    expect(visible.edges.map((edge) => edge.id)).toContain(hiddenEdge.id);

    await prisma.reviewVersion.update({
      where: { id: readableVersion.id },
      data: { publicState: "tombstoned" },
    });
    await assertHidden();
  });

  it("returns typed errors instead of truncating traversal and topic scans", async () => {
    const overflow = await createNode(repositoryId, "overflow-source", "claim", "d", {
      statement: "Overflow source.",
      qualifiers: [],
    });
    const overflowReview = await prisma.review.create({
      data: { slug: "graph-overflow", title: "Graph overflow", status: "published" },
    });
    await prisma.reviewVersion.create({
      data: {
        reviewId: overflowReview.id,
        snapshotId: overflow.snapshotId,
        title: "Graph overflow",
        metadataJson: "{}",
        publicState: "published",
      },
    });
    const targetNodes = Array.from({ length: 501 }, (_, index) => ({
      id: `overflow-node-${index.toString().padStart(3, "0")}`,
      repositoryId,
      localNodeId: `overflow-target-${index}`,
      kind: "claim",
    }));
    for (let index = 0; index < targetNodes.length; index += 100) {
      await prisma.knowledgeNode.createMany({ data: targetNodes.slice(index, index + 100) });
    }
    const versions = targetNodes.map((node, index) => ({
      id: `overflow-version-${index.toString().padStart(3, "0")}`,
      knowledgeNodeId: node.id,
      snapshotId: overflow.snapshotId,
      title: `Overflow target ${index}`,
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({ sourcePath: `nodes/overflow-${index}.json` }),
      payloadJson: canonicalJson({ statement: `Overflow target ${index}.`, qualifiers: [] }),
    }));
    for (let index = 0; index < versions.length; index += 50) {
      await prisma.knowledgeNodeVersion.createMany({ data: versions.slice(index, index + 50) });
    }
    const edges = targetNodes.map((node, index) => ({
      id: `overflow-edge-${index.toString().padStart(3, "0")}`,
      sourceNodeVersionId: overflow.versionId,
      targetNodeId: node.id,
      relationType: "supports",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: versions[index]!.id,
      confirmedById: editorId,
      confirmedAt: new Date("2026-04-01T00:00:00Z"),
    }));
    for (let index = 0; index < edges.length; index += 50) {
      await prisma.nodeEdge.createMany({ data: edges.slice(index, index + 50) });
    }
    await expect(query({ seed: overflow.nodeId, depth: 1 })).rejects.toThrow(
      "500-edge traversal bound",
    );

    const extraNodes = Array.from({ length: 600 }, (_, index) => ({
      id: `topic-overflow-${index.toString().padStart(3, "0")}`,
      repositoryId,
      localNodeId: `topic-overflow-${index}`,
      kind: "claim",
    }));
    for (let index = 0; index < extraNodes.length; index += 100) {
      await prisma.knowledgeNode.createMany({ data: extraNodes.slice(index, index + 100) });
    }
    const extraVersions = extraNodes.map((node, index) => ({
      id: `topic-overflow-version-${index.toString().padStart(3, "0")}`,
      knowledgeNodeId: node.id,
      snapshotId: overflow.snapshotId,
      title: `Topic overflow ${index}`,
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({ sourcePath: `nodes/topic-overflow-${index}.json` }),
      payloadJson: canonicalJson({ statement: `Topic overflow ${index}.`, qualifiers: [] }),
    }));
    for (let index = 0; index < extraVersions.length; index += 50) {
      await prisma.knowledgeNodeVersion.createMany({
        data: extraVersions.slice(index, index + 50),
      });
    }
    await expect(query({ q: "overflow", depth: 0 })).rejects.toThrow("1,000-node scan bound");
  }, 60_000);
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
