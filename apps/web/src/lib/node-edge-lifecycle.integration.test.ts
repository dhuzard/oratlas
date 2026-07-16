import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@oratlas/db";
import { canonicalJson } from "@oratlas/contracts";
import type * as EdgeLifecycle from "./node-edge-lifecycle";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-node-edges-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;

let prisma: PrismaClient;
let lifecycle: typeof EdgeLifecycle;
let editor: { id: string; role: string };
let reader: { id: string; role: string };
let sourceVersionId: string;
let targetVersionId: string;
let sourceNodeId: string;
let targetNodeId: string;
let agentSequence = 0;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      "packages/db/prisma/schema.prisma",
      "--skip-generate",
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
  );
  ({ prisma } = await import("./db"));
  lifecycle = await import("./node-edge-lifecycle");
  const editorRow = await prisma.user.create({
    data: { githubUserId: "edge-editor", githubLogin: "edge-editor", role: "EDITOR" },
  });
  const readerRow = await prisma.user.create({
    data: { githubUserId: "edge-reader", githubLogin: "edge-reader", role: "USER" },
  });
  editor = { id: editorRow.id, role: editorRow.role };
  reader = { id: readerRow.id, role: readerRow.role };
  const source = await createNode("source-lab", "source-claim", "claim", "a");
  const target = await createNode("target-lab", "target-claim", "claim", "b");
  sourceVersionId = source.versionId;
  targetVersionId = target.versionId;
  sourceNodeId = source.nodeId;
  targetNodeId = target.nodeId;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    await removeSqliteTestFile(path);
  }
});

async function removeSqliteTestFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      if (existsSync(path)) rmSync(path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      const transientWindowsLock =
        process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
      if (!transientWindowsLock) throw error;
      if (attempt === 5) return;
      await delay(25 * 2 ** attempt);
    }
  }
}

describe.sequential("node edge lifecycle integration", () => {
  it("fails closed for legacy confirmed rows without frozen editorial confirmation", async () => {
    const legacy = await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId: sourceVersionId,
        targetNodeId,
        relationType: "uses-code",
        status: "confirmed",
        provenance: "confirmed-by-editor",
      },
    });
    expect(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).some(
        (edge) => edge.id === legacy.id,
      ),
    ).toBe(false);
    const wrongTarget = await createNode("wrong-target", "wrong-target", "code", "e");
    await prisma.nodeEdge.update({
      where: { id: legacy.id },
      data: {
        confirmedTargetNodeVersionId: wrongTarget.versionId,
        confirmedById: editor.id,
        confirmedAt: new Date(),
      },
    });
    expect(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).some(
        (edge) => edge.id === legacy.id,
      ),
    ).toBe(false);

    const codeTarget = await createNode("authority-target", "authority-code", "code", "f");
    const editorSource = await createNode(
      "authority-source",
      "editor-confirmed-source",
      "claim",
      "0",
    );
    const userConfirmed = await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId: sourceVersionId,
        targetNodeId: codeTarget.nodeId,
        relationType: "uses-code",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedTargetNodeVersionId: codeTarget.versionId,
        confirmedById: reader.id,
        confirmedAt: new Date(),
      },
    });
    const editorConfirmed = await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId: editorSource.versionId,
        targetNodeId: codeTarget.nodeId,
        relationType: "uses-code",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedTargetNodeVersionId: codeTarget.versionId,
        confirmedById: editor.id,
        confirmedAt: new Date(),
      },
    });
    expect(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).some(
        (edge) => edge.id === userConfirmed.id,
      ),
    ).toBe(false);
    expect(
      (await lifecycle.listConfirmedEdgesForNode(editorSource.nodeId)).map((edge) => edge.id),
    ).toContain(editorConfirmed.id);

    const rehabilitation = await prisma.nodeEdgeProposal.create({
      data: {
        originKey: "rehabilitate-user-attributed-edge",
        sourceStableKey: "source-stable-key",
        targetStableKey: "code-target-stable-key",
        sourceNodeVersionId: sourceVersionId,
        targetNodeId: codeTarget.nodeId,
        targetNodeVersionId: codeTarget.versionId,
        relationType: "uses-code",
        origin: "asserted-by-author",
        evidenceJson: "{}",
      },
    });
    const decision = await lifecycle.decideNodeEdgeProposal(editor, rehabilitation.id, {
      decision: "confirm",
      expectedRevision: 0,
      note: "A current editor independently checked this legacy relation.",
    });
    expect(decision.edgeId).toBe(userConfirmed.id);
    expect(
      await prisma.nodeEdge.findUniqueOrThrow({ where: { id: userConfirmed.id } }),
    ).toMatchObject({
      confirmedById: editor.id,
      provenance: "confirmed-by-editor",
    });
    expect(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).map((edge) => edge.id),
    ).toContain(userConfirmed.id);
  });

  it("fails closed when a cross-lab address resolves ambiguously", async () => {
    const duplicate = {
      id: "external-version",
      knowledgeNodeId: "external-node",
      knowledgeNode: { localNodeId: "dataset:shared", kind: "dataset" },
    };
    const tx = {
      knowledgeNodeVersion: { findMany: async () => [duplicate, { ...duplicate, id: "other" }] },
    };
    await expect(
      lifecycle.materializeAuthorEdgeProposals(tx as never, {
        submissionId: "submission",
        submitterId: editor.id,
        inspectionCaptureId: "capture",
        capturePayloadHash: "a".repeat(64),
        sourceRepositoryGithubId: "101",
        sourceCommitSha: "a".repeat(40),
        selectedVersions: [
          {
            id: sourceVersionId,
            knowledgeNodeId: sourceNodeId,
            localNodeId: "source-claim",
            kind: "claim",
          },
        ],
        edges: [
          {
            status: "ok",
            sourcePath: "nodes/edges.jsonl",
            sourcePointer: "/0",
            edge: {
              sourceNodeId: "source-claim",
              targetNodeId: "dataset:shared",
              relationType: "uses-dataset",
              targetRepository: {
                githubRepositoryId: "202",
                commitSha: "b".repeat(40),
              },
            },
          },
        ],
      }),
    ).rejects.toThrow(/ambiguously/);
    expect(tx).toBeDefined();
  });

  it("requires immutable source identity only when an author edge would materialize", async () => {
    await expect(
      prisma.$transaction((tx) =>
        lifecycle.materializeAuthorEdgeProposals(tx, {
          submissionId: "submission-with-dangling-edge",
          submitterId: editor.id,
          inspectionCaptureId: "capture-with-dangling-edge",
          capturePayloadHash: "a".repeat(64),
          sourceRepositoryGithubId: null,
          sourceCommitSha: "a".repeat(40),
          selectedVersions: [
            {
              id: sourceVersionId,
              knowledgeNodeId: sourceNodeId,
              localNodeId: "source-claim",
              kind: "claim",
            },
          ],
          edges: [
            {
              status: "ok",
              sourcePath: "nodes/edges.jsonl",
              sourcePointer: "/0",
              edge: {
                sourceNodeId: "source-claim",
                targetNodeId: "unselected-target",
                relationType: "supports",
              },
            },
          ],
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      prisma.$transaction((tx) =>
        lifecycle.materializeAuthorEdgeProposals(tx, {
          submissionId: "submission-with-materializable-edge",
          submitterId: editor.id,
          inspectionCaptureId: "capture-with-materializable-edge",
          capturePayloadHash: "a".repeat(64),
          sourceRepositoryGithubId: null,
          sourceCommitSha: "a".repeat(40),
          selectedVersions: [
            {
              id: sourceVersionId,
              knowledgeNodeId: sourceNodeId,
              localNodeId: "source-claim",
              kind: "claim",
            },
            {
              id: targetVersionId,
              knowledgeNodeId: targetNodeId,
              localNodeId: "target-claim",
              kind: "claim",
            },
          ],
          edges: [
            {
              status: "ok",
              sourcePath: "nodes/edges.jsonl",
              sourcePointer: "/0",
              edge: {
                sourceNodeId: "source-claim",
                targetNodeId: "target-claim",
                relationType: "supports",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/immutable source repository identity/);
  });

  it("creates an attributable agent proposal idempotently", async () => {
    const run = await createAgentRun("contradicts");
    const input = proposalInput(run.id, "contradicts");
    const first = await lifecycle.createAgentNodeEdgeProposal(input);
    const retry = await lifecycle.createAgentNodeEdgeProposal(input);
    expect(first.idempotent).toBe(false);
    expect(retry).toEqual({ proposalId: first.proposalId, idempotent: true });
    expect(await prisma.nodeEdgeProposal.count({ where: { id: first.proposalId } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "node-edge.proposed", subjectId: first.proposalId },
      }),
    ).toBe(1);
  });

  it("confirms once, retries exactly, and projects one contradiction from both endpoints", async () => {
    const proposal = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("contradicts")).id, "contradicts"),
    );
    const decision = {
      decision: "confirm" as const,
      expectedRevision: 0,
      note: "Evidence and provenance checked.",
    };
    const confirmed = await lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, decision);
    const retry = await lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, decision);
    expect(confirmed).toMatchObject({ status: "confirmed", revision: 1, idempotent: false });
    expect(retry).toMatchObject({ edgeId: confirmed.edgeId, idempotent: true });
    expect(await prisma.nodeEdge.count({ where: { id: confirmed.edgeId } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "node-edge.confirmed", subjectId: proposal.proposalId },
      }),
    ).toBe(1);
    expect(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).map((edge) => edge.id),
    ).toContain(confirmed.edgeId);
    expect(
      (await lifecycle.listConfirmedEdgesForNode(targetNodeId)).map((edge) => edge.id),
    ).toEqual([confirmed.edgeId]);
  });

  it("canonicalizes a reciprocal contradiction onto the existing edge", async () => {
    const reverseCandidate = proposalCandidate("contradicts", true);
    const run = await createAgentRun("contradicts", reverseCandidate);
    const proposal = await lifecycle.createAgentNodeEdgeProposal({
      agentRunId: run.id,
      ...reverseCandidate,
    });
    const result = await lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, {
      decision: "confirm",
      expectedRevision: 0,
      note: "Reciprocal declaration checked.",
    });
    expect(await prisma.nodeEdge.count({ where: { relationType: "contradicts" } })).toBe(1);
    expect(result.edgeId).toBe(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).find(
        (edge) => edge.relationType === "contradicts",
      )?.id,
    );
  });

  it("preserves a second origin while reusing the confirmed logical edge", async () => {
    const first = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("extends")).id, "extends"),
    );
    const second = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("extends")).id, "extends"),
    );
    const one = await lifecycle.decideNodeEdgeProposal(editor, first.proposalId, {
      decision: "confirm",
      expectedRevision: 0,
      note: "First independent origin checked.",
    });
    const two = await lifecycle.decideNodeEdgeProposal(editor, second.proposalId, {
      decision: "confirm",
      expectedRevision: 0,
      note: "Second independent origin checked.",
    });
    expect(two.edgeId).toBe(one.edgeId);
    expect(await prisma.nodeEdgeProposal.count({ where: { confirmedEdgeId: one.edgeId } })).toBe(2);
    await lifecycle.decideNodeEdgeProposal(editor, first.proposalId, {
      decision: "supersede",
      expectedRevision: 1,
      note: "One origin was superseded; another confirmation remains.",
    });
    expect(await prisma.nodeEdge.findUniqueOrThrow({ where: { id: one.edgeId } })).toMatchObject({
      status: "confirmed",
    });
    await lifecycle.decideNodeEdgeProposal(editor, second.proposalId, {
      decision: "supersede",
      expectedRevision: 1,
      note: "The final supporting confirmation is now superseded.",
    });
    expect(await prisma.nodeEdge.findUniqueOrThrow({ where: { id: one.edgeId } })).toMatchObject({
      status: "superseded",
    });
    expect(
      (await lifecycle.listConfirmedEdgesForNode(sourceNodeId)).some(
        (edge) => edge.id === one.edgeId,
      ),
    ).toBe(false);
  });

  it("rejects without creating a public edge and refuses a changed retry", async () => {
    const proposal = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("replicates")).id, "replicates"),
    );
    await lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, {
      decision: "reject",
      expectedRevision: 0,
      note: "The evidence does not support this relation.",
    });
    expect(await prisma.nodeEdge.count({ where: { relationType: "replicates" } })).toBe(0);
    await expect(
      lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, {
        decision: "confirm",
        expectedRevision: 0,
        note: "A conflicting later decision is forbidden.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("allows exactly one concurrent decision", async () => {
    const proposal = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("supports")).id, "supports"),
    );
    const results = await Promise.allSettled([
      lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, {
        decision: "confirm",
        expectedRevision: 0,
        note: "Concurrent confirmation decision.",
      }),
      lifecycle.decideNodeEdgeProposal(editor, proposal.proposalId, {
        decision: "reject",
        expectedRevision: 0,
        note: "Concurrent rejection decision.",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("checks the actor's current database role", async () => {
    const proposal = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("derives-from")).id, "derives-from"),
    );
    await expect(
      lifecycle.decideNodeEdgeProposal(reader, proposal.proposalId, {
        decision: "reject",
        expectedRevision: 0,
        note: "Readers cannot make editorial decisions.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reuses one edge for concurrent independent confirmations", async () => {
    const first = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("derives-from")).id, "derives-from"),
    );
    const second = await lifecycle.createAgentNodeEdgeProposal(
      proposalInput((await createAgentRun("derives-from")).id, "derives-from"),
    );
    const results = await Promise.all([
      lifecycle.decideNodeEdgeProposal(editor, first.proposalId, {
        decision: "confirm",
        expectedRevision: 0,
        note: "Independent confirmation one.",
      }),
      lifecycle.decideNodeEdgeProposal(editor, second.proposalId, {
        decision: "confirm",
        expectedRevision: 0,
        note: "Independent confirmation two.",
      }),
    ]);
    expect(results[0].edgeId).toBe(results[1].edgeId);
    expect(await prisma.nodeEdge.count({ where: { relationType: "derives-from" } })).toBe(1);
  });

  it("rejects unrelated, incomplete, and mismatched agent runs", async () => {
    const candidate = proposalInput("placeholder", "extends");
    for (const [agentType, status] of [
      ["discussion-answer", "succeeded"],
      ["node-edge-proposal", "running"],
      ["node-edge-proposal", "failed"],
    ] as const) {
      const run = await createAgentRun("extends", {}, { agentType, status });
      await expect(
        lifecycle.createAgentNodeEdgeProposal({ ...candidate, agentRunId: run.id }),
      ).rejects.toMatchObject({ code: "conflict" });
    }
    const run = await createAgentRun("supports");
    await expect(
      lifecycle.createAgentNodeEdgeProposal({ ...candidate, agentRunId: run.id }),
    ).rejects.toThrow(/does not match/);
  });

  it("resolves an idempotent retry after reconciler-style foreign-key rewrites", async () => {
    const run = await createAgentRun("supports");
    const input = proposalInput(run.id, "supports");
    const created = await lifecycle.createAgentNodeEdgeProposal(input);
    const replacementSource = await createNode("survivor-source", "survivor-source", "claim", "c");
    const replacementTarget = await createNode("survivor-target", "survivor-target", "claim", "d");
    await prisma.nodeEdgeProposal.update({
      where: { id: created.proposalId },
      data: {
        sourceNodeVersionId: replacementSource.versionId,
        targetNodeId: replacementTarget.nodeId,
        targetNodeVersionId: replacementTarget.versionId,
      },
    });
    expect(await lifecycle.createAgentNodeEdgeProposal(input)).toEqual({
      proposalId: created.proposalId,
      idempotent: true,
    });
  });
});

async function createAgentRun(
  relationType: string,
  overrides: Partial<ReturnType<typeof proposalCandidate>> = {},
  runOverrides: { agentType?: string; status?: string } = {},
) {
  agentSequence += 1;
  const requestCandidate = { ...proposalCandidate(relationType), ...overrides };
  const candidate = {
    sourceStableKey:
      requestCandidate.sourceNodeVersionId === sourceVersionId
        ? stableKey("97", "source-claim", "a")
        : stableKey("98", "target-claim", "b"),
    targetStableKey:
      requestCandidate.targetNodeVersionId === targetVersionId
        ? stableKey("98", "target-claim", "b")
        : stableKey("97", "source-claim", "a"),
    relationType: requestCandidate.relationType,
    rationale: requestCandidate.rationale,
    evidence: requestCandidate.evidence,
  };
  const candidateJson = canonicalJson(candidate);
  return prisma.agentRun.create({
    data: {
      id: `edge-agent-run-${agentSequence}`,
      agentType: runOverrides.agentType ?? "node-edge-proposal",
      status: runOverrides.status ?? "succeeded",
      completedAt: new Date(),
      outputJson: canonicalJson({
        candidate,
        candidateHash: createHash("sha256").update(candidateJson).digest("hex"),
      }),
    },
  });
}

function proposalInput(agentRunId: string, relationType: string) {
  return {
    agentRunId,
    ...proposalCandidate(relationType),
  };
}

function proposalCandidate(relationType: string, reverse = false) {
  return {
    sourceNodeVersionId: reverse ? targetVersionId : sourceVersionId,
    targetNodeVersionId: reverse ? sourceVersionId : targetVersionId,
    relationType,
    rationale: `Candidate ${relationType} relation.`,
    evidence: { method: "deterministic-test", references: [sourceVersionId, targetVersionId] },
  };
}

function stableKey(githubRepositoryId: string, localNodeId: string, commitMarker: string) {
  return canonicalJson({
    githubRepositoryId,
    localNodeId,
    commitSha: commitMarker.repeat(40),
  });
}

async function createNode(owner: string, localNodeId: string, kind: string, marker: string) {
  const repository = await prisma.repository.create({
    data: {
      owner,
      name: "edge-nodes",
      canonicalUrl: `https://github.com/${owner}/edge-nodes`,
      githubRepositoryId: `${marker.charCodeAt(0)}`,
    },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha: marker.repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: marker.repeat(64),
    },
  });
  const node = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId, kind },
  });
  const version = await prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: node.id,
      snapshotId: snapshot.id,
      title: localNodeId,
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({ sourcePath: `nodes/${localNodeId}.json` }),
      payloadJson: canonicalJson(
        kind === "code"
          ? { entryPoints: ["src/main.ts"], language: "TypeScript", releaseRef: "v1" }
          : { statement: `${localNodeId} statement.`, qualifiers: [] },
      ),
    },
  });
  return { nodeId: node.id, versionId: version.id };
}
