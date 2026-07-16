import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client/index.js";
import { assertKnowledgeNodeMaterializationBinding } from "./knowledge-node-integrity.js";
import { upsertNodeAlias } from "./node-aliases.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const databaseName = `knowledge-nodes-${process.pid}-${Date.now()}.db`;
const databasePath = join(root, "packages", "db", "prisma", databaseName);
// Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
const databaseUrl = `file:./${databaseName}`;
let prisma: PrismaClient;

beforeAll(() => {
  const prismaArgs = [
    "--filter",
    "@oratlas/db",
    "exec",
    "prisma",
    "db",
    "push",
    "--schema",
    "prisma/schema.prisma",
    "--skip-generate",
  ];
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", `pnpm ${prismaArgs.join(" ")}`] : prismaArgs;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Prisma db push failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  }
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("knowledge-node persistence", () => {
  it("persists immutable versions, typed edges, and nullable legacy claim backlinks", async () => {
    const repository = await prisma.repository.create({
      data: {
        owner: "lab-a",
        name: "nodes",
        canonicalUrl: "https://github.com/lab-a/nodes",
        githubRepositoryId: "12345",
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
    const submitter = await prisma.user.create({
      data: { githubLogin: "node-submitter", role: "USER" },
    });
    const capture = await prisma.inspectionCapture.create({
      data: {
        tokenHash: "capture-token-hash",
        payloadJson: '{"nodes":[]}',
        payloadHash: "c".repeat(64),
        githubRepositoryId: "12345",
        canonicalUrlAtCapture: repository.canonicalUrl,
        inspectedByUserId: submitter.id,
        commitSha: snapshot.commitSha,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    const submission = await prisma.submission.create({
      data: {
        submitterId: submitter.id,
        repositoryId: repository.id,
        snapshotId: snapshot.id,
        inspectionCaptureId: capture.id,
        status: "accepted",
      },
    });
    const sourceNode = await prisma.knowledgeNode.create({
      data: { repositoryId: repository.id, localNodeId: "claim-a", kind: "claim" },
    });
    const targetNode = await prisma.knowledgeNode.create({
      data: { repositoryId: repository.id, localNodeId: "dataset-a", kind: "dataset" },
    });
    const sourceAlias = await upsertNodeAlias(prisma, {
      knowledgeNodeId: sourceNode.id,
      alias: {
        scheme: "doi",
        role: "work-doi",
        value: "https://doi.org/10.1000/SHARED-WORK",
      },
    });
    const equivalentSourceAlias = await upsertNodeAlias(prisma, {
      knowledgeNodeId: sourceNode.id,
      alias: {
        scheme: "doi",
        role: "work-doi",
        value: "10.1000/shared-work",
      },
    });
    expect(equivalentSourceAlias.id).toBe(sourceAlias.id);
    await upsertNodeAlias(prisma, {
      knowledgeNodeId: targetNode.id,
      alias: {
        scheme: "doi",
        role: "artifact-doi",
        value: "10.1000/shared-work",
      },
    });
    await upsertNodeAlias(prisma, {
      knowledgeNodeId: targetNode.id,
      alias: {
        scheme: "doi",
        role: "concept-doi",
        value: "10.5555/example-concept",
        isExample: true,
      },
    });
    const sourceVersion = await prisma.knowledgeNodeVersion.create({
      data: {
        knowledgeNodeId: sourceNode.id,
        snapshotId: snapshot.id,
        sourceSubmissionId: submission.id,
        inspectionCaptureId: capture.id,
        capturePayloadHash: capture.payloadHash,
        title: "Claim A",
        contributorsJson: "[]",
        license: "CC-BY-4.0",
        provenanceJson: '{"sourcePath":"nodes/claim-a.json"}',
        payloadJson: '{"statement":"Claim A","qualifiers":[]}',
      },
    });
    await prisma.knowledgeNodeVersion.create({
      data: {
        knowledgeNodeId: targetNode.id,
        snapshotId: snapshot.id,
        title: "Dataset A",
        contributorsJson: "[]",
        license: "CC-BY-4.0",
        provenanceJson: '{"sourcePath":"nodes/dataset-a.json"}',
        payloadJson: '{"artifactPath":"data/a.csv","format":"text/csv","sizeBytes":10}',
      },
    });
    const edge = await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId: sourceVersion.id,
        targetNodeId: targetNode.id,
        relationType: "uses-dataset",
        status: "confirmed",
        provenance: "confirmed-by-editor",
      },
    });

    const review = await prisma.review.create({ data: { slug: "legacy", title: "Legacy" } });
    const reviewVersion = await prisma.reviewVersion.create({
      data: {
        reviewId: review.id,
        snapshotId: snapshot.id,
        title: "Legacy",
        metadataJson: "{}",
      },
    });
    const unlinkedClaim = await prisma.claim.create({
      data: {
        reviewVersionId: reviewVersion.id,
        localClaimId: "legacy-unlinked",
        text: "Legacy unlinked claim",
        normalizedText: "legacy unlinked claim",
      },
    });
    const linkedClaim = await prisma.claim.create({
      data: {
        reviewVersionId: reviewVersion.id,
        knowledgeNodeId: sourceNode.id,
        localClaimId: "legacy-linked",
        text: "Legacy linked claim",
        normalizedText: "legacy linked claim",
      },
      include: { knowledgeNode: true },
    });

    expect(unlinkedClaim.knowledgeNodeId).toBeNull();
    expect(linkedClaim.knowledgeNode?.localNodeId).toBe("claim-a");
    expect(JSON.parse(sourceVersion.payloadJson)).toEqual({
      statement: "Claim A",
      qualifiers: [],
    });
    expect(edge.relationType).toBe("uses-dataset");
    const sharedAliases = await prisma.nodeAlias.findMany({
      where: { scheme: "doi", value: "10.1000/shared-work" },
      orderBy: { knowledgeNodeId: "asc" },
    });
    expect(sharedAliases).toHaveLength(2);
    expect(new Set(sharedAliases.map((alias) => alias.knowledgeNodeId))).toEqual(
      new Set([sourceNode.id, targetNode.id]),
    );
    expect(
      await prisma.nodeAlias.findFirstOrThrow({
        where: { knowledgeNodeId: targetNode.id, role: "concept-doi" },
      }),
    ).toMatchObject({ isExample: true, value: "10.5555/example-concept" });
    const tracedVersion = await prisma.knowledgeNodeVersion.findUniqueOrThrow({
      where: { id: sourceVersion.id },
      include: {
        knowledgeNode: true,
        snapshot: true,
        sourceSubmission: true,
        inspectionCapture: true,
      },
    });
    expect(tracedVersion.sourceSubmission?.id).toBe(submission.id);
    expect(tracedVersion.inspectionCapture?.payloadHash).toBe(capture.payloadHash);
    expect(tracedVersion.capturePayloadHash).toBe(capture.payloadHash);
    expect(() =>
      assertKnowledgeNodeMaterializationBinding({
        repository,
        node: tracedVersion.knowledgeNode,
        snapshot: tracedVersion.snapshot,
        submission: tracedVersion.sourceSubmission!,
        capture: tracedVersion.inspectionCapture!,
        version: tracedVersion,
      }),
    ).not.toThrow();

    await expect(
      prisma.knowledgeNode.create({
        data: { repositoryId: repository.id, localNodeId: "claim-a", kind: "claim" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: sourceNode.id,
          snapshotId: snapshot.id,
          title: "Duplicate",
          license: "MIT",
          provenanceJson: "{}",
          payloadJson: "{}",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.nodeEdge.create({
        data: {
          sourceNodeVersionId: sourceVersion.id,
          targetNodeId: targetNode.id,
          relationType: "uses-dataset",
          status: "confirmed",
          provenance: "confirmed-by-editor",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.nodeAlias.create({
        data: {
          knowledgeNodeId: sourceNode.id,
          scheme: "doi",
          role: "work-doi",
          value: "10.1000/shared-work",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
