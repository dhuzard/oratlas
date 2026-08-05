import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalGraphQuerySchema, canonicalGraphResponseSchema } from "@oratlas/contracts";
import { applyDatabaseGuards } from "@oratlas/db";
import { PrismaClient } from "../../../../packages/db/generated/client/index.js";
import { materializeCanonicalReviewGraph } from "./canonical-graph-materialization";
import type * as CanonicalGraphQueryModule from "./canonical-graph-query";

vi.mock("server-only", () => ({}));

const fileName = `.tmp-oratlas-canonical-graph-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = `file:./${fileName}`;
let prisma: PrismaClient;
let reviewVersionId: string;
let claimId: string;
let repositoryId: string;
let snapshotId: string;
let canonicalGraph: typeof CanonicalGraphQueryModule;
let canonicalGraphPrisma: PrismaClient;

describe("canonical review graph materialization", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_SECRET = "canonical-graph-query-integration-secret";
    const require = createRequire(import.meta.url);
    const prismaPackage = require.resolve("prisma/package.json", {
      paths: [resolve(process.cwd(), "packages/db")],
    });
    const prismaCli = resolve(dirname(prismaPackage), "build/index.js");
    try {
      execFileSync(
        process.execPath,
        [
          prismaCli,
          "db",
          "push",
          "--schema",
          "packages/db/prisma/schema.prisma",
          "--skip-generate",
        ],
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
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await applyDatabaseGuards(prisma, "sqlite");
    ({ prisma: canonicalGraphPrisma } = await import("./db"));
    canonicalGraph = await import("./canonical-graph-query");

    const repository = await prisma.repository.create({
      data: {
        owner: "canonical-graph",
        name: "fixture",
        canonicalUrl: "https://github.com/canonical-graph/fixture",
        githubRepositoryId: "canonical-graph-fixture",
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
    repositoryId = repository.id;
    snapshotId = snapshot.id;
    const review = await prisma.review.create({
      data: {
        slug: "canonical-graph-fixture",
        repositoryId: repository.id,
        currentSnapshotId: snapshot.id,
        title: "Canonical graph fixture",
        licenseSpdx: "CC-BY-4.0",
        status: "published",
      },
    });
    const version = await prisma.reviewVersion.create({
      data: {
        reviewId: review.id,
        snapshotId: snapshot.id,
        title: review.title,
        metadataJson: "{}",
        publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    });
    reviewVersionId = version.id;
    const claim = await prisma.claim.create({
      data: {
        reviewVersionId: version.id,
        localClaimId: "claim-1",
        text: "A bounded source assertion.",
        normalizedText: "a bounded source assertion.",
      },
    });
    claimId = claim.id;
    const first = await prisma.citation.create({
      data: {
        reviewVersionId: version.id,
        localCitationId: "citation-1",
        doi: "https://doi.org/10.1000/SHARED",
        title: "Shared work, first occurrence",
      },
    });
    const second = await prisma.citation.create({
      data: {
        reviewVersionId: version.id,
        localCitationId: "citation-2",
        doi: "10.1000/shared",
        title: "Shared work, second occurrence",
      },
    });
    await prisma.claimEvidenceRelation.createMany({
      data: [
        { claimId: claim.id, citationId: first.id, relationType: "supports" },
        { claimId: claim.id, citationId: second.id, relationType: "supports" },
      ],
    });
    const assessedRelation = await prisma.claimEvidenceRelation.findFirstOrThrow({
      where: { claimId: claim.id },
      orderBy: { id: "asc" },
    });
    await prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: assessedRelation.id,
        protocolVersion: "TRUST-1.0",
        assessorType: "agent",
      },
    });
  }, 30_000);

  afterAll(async () => {
    await canonicalGraphPrisma?.$disconnect();
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

  it("dual-writes exact graph records and remains idempotent", async () => {
    const first = await prisma.$transaction((tx) =>
      materializeCanonicalReviewGraph(tx, reviewVersionId),
    );
    const second = await prisma.$transaction((tx) =>
      materializeCanonicalReviewGraph(tx, reviewVersionId),
    );
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      claimCount: 1,
      reviewAssertionEdgeCount: 1,
      workCount: 2,
      evidenceEdgeCount: 2,
      workIdentityConflictCount: 0,
    });

    const review = await prisma.review.findFirstOrThrow({
      where: { versions: { some: { id: reviewVersionId } } },
      include: { knowledgeNode: true },
    });
    expect(review.knowledgeNode).toMatchObject({
      repositoryId: null,
      kind: "review",
      originType: "review-record",
    });
    const claim = await prisma.claim.findUniqueOrThrow({
      where: { id: claimId },
      include: { knowledgeNode: true, graphVersion: true },
    });
    expect(claim.knowledgeNode).toMatchObject({
      repositoryId: null,
      kind: "claim",
      originType: "claim-occurrence",
    });
    expect(claim.graphVersion?.sourceClaimId).toBe(claim.id);

    const citations = await prisma.citation.findMany({
      where: { reviewVersionId },
      include: { graphVersion: true },
      orderBy: { id: "asc" },
    });
    expect(new Set(citations.map(({ knowledgeNodeId }) => knowledgeNodeId)).size).toBe(1);
    expect(new Set(citations.map(({ workId }) => workId))).toEqual(
      new Set(["work:doi:10.1000/shared"]),
    );
    expect(citations.every(({ graphVersion }) => graphVersion?.sourceCitationId)).toBe(true);

    const relations = await prisma.claimEvidenceRelation.findMany({
      where: { claimId },
      include: { nodeEdge: true },
    });
    expect(new Set(relations.map(({ nodeEdgeId }) => nodeEdgeId)).size).toBe(2);
    expect(
      relations.every(
        ({ nodeEdge }) =>
          nodeEdge?.status === "source-assertion" &&
          nodeEdge.provenance === "imported-from-review" &&
          nodeEdge.confirmedById === null,
      ),
    ).toBe(true);
  });

  it("pages exact source-assertion neighborhoods without presentation fields", async () => {
    const claim = await prisma.claim.findUniqueOrThrow({
      where: { id: claimId },
      include: { graphVersion: true },
    });
    const first = await canonicalGraph.queryCanonicalGraph(
      canonicalGraphQuerySchema.parse({
        seed: claim.knowledgeNodeId,
        version: claim.graphVersion?.id,
        status: "source-assertion",
        direction: "outgoing",
        limit: 1,
      }),
    );
    expect(canonicalGraphResponseSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "2.0.0",
      seed: { nodeId: claim.knowledgeNodeId, nodeVersionId: claim.graphVersion?.id },
      page: { limit: 1 },
    });
    expect(first.edges).toHaveLength(1);
    expect(first.edges[0]).toMatchObject({
      sourceNodeId: claim.knowledgeNodeId,
      sourceNodeVersionId: claim.graphVersion?.id,
      status: "source-assertion",
      provenance: "imported-from-review",
    });
    expect(first.page.nextCursor).toBeTruthy();
    expect(
      first.nodes.find(({ nodeVersionId }) => nodeVersionId === claim.graphVersion?.id),
    ).toMatchObject({
      originType: "claim-occurrence",
      kind: "claim",
      source: { type: "claim-occurrence", claimId },
    });
    expect(JSON.stringify(first)).not.toMatch(/graphHref|recordHref|href/);

    const laterCitation = await prisma.citation.create({
      data: {
        reviewVersionId,
        localCitationId: "citation-after-cursor",
        doi: "10.1000/after-cursor",
        title: "Work added after traversal began",
      },
    });
    const laterRelation = await prisma.claimEvidenceRelation.create({
      data: { claimId, citationId: laterCitation.id, relationType: "contextualizes" },
    });
    await prisma.$transaction((tx) => materializeCanonicalReviewGraph(tx, reviewVersionId));
    const materializedLaterRelation = await prisma.claimEvidenceRelation.findUniqueOrThrow({
      where: { id: laterRelation.id },
    });

    const second = await canonicalGraph.queryCanonicalGraph(
      canonicalGraphQuerySchema.parse({
        seed: claim.knowledgeNodeId,
        version: claim.graphVersion?.id,
        status: "source-assertion",
        direction: "outgoing",
        limit: 1,
        cursor: first.page.nextCursor,
      }),
    );
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0]?.id).not.toBe(first.edges[0]?.id);
    expect(second.edges[0]?.id).not.toBe(materializedLaterRelation.nodeEdgeId);
    expect(second.page.nextCursor).toBeUndefined();

    const fresh = await canonicalGraph.queryCanonicalGraph(
      canonicalGraphQuerySchema.parse({
        seed: claim.knowledgeNodeId,
        version: claim.graphVersion?.id,
        status: "source-assertion",
        direction: "outgoing",
        limit: 10,
      }),
    );
    expect(fresh.edges.map(({ id }) => id)).toContain(materializedLaterRelation.nodeEdgeId);
    expect(fresh.edges.some(({ trustAssessments }) => trustAssessments.length === 1)).toBe(true);

    const reviewVersion = await prisma.reviewVersion.findUniqueOrThrow({
      where: { id: reviewVersionId },
      include: { review: true, graphVersion: true },
    });
    const reviewTraversal = await canonicalGraph.queryCanonicalGraph(
      canonicalGraphQuerySchema.parse({
        seed: reviewVersion.review.knowledgeNodeId,
        version: reviewVersion.graphVersion?.id,
        status: "source-assertion",
        direction: "outgoing",
      }),
    );
    expect(reviewTraversal.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: reviewVersion.review.knowledgeNodeId,
        sourceNodeVersionId: reviewVersion.graphVersion?.id,
        targetNodeId: claim.knowledgeNodeId,
        targetNodeVersionId: claim.graphVersion?.id,
        relationType: "asserts",
      }),
    );
  });

  it("fails closed to an occurrence work when aliases point at different candidates", async () => {
    const [doiWork, pmidWork] = await Promise.all([
      prisma.knowledgeNode.create({
        data: {
          stableKey: "work:doi:10.1000/conflict",
          originType: "canonical-work",
          localNodeId: "work-conflict-doi",
          kind: "work",
          aliases: {
            create: { scheme: "doi", role: "work-doi", value: "10.1000/conflict" },
          },
        },
      }),
      prisma.knowledgeNode.create({
        data: {
          stableKey: "work:pmid:12345",
          originType: "canonical-work",
          localNodeId: "work-conflict-pmid",
          kind: "work",
          aliases: { create: { scheme: "pmid", role: "work-pmid", value: "12345" } },
        },
      }),
    ]);
    const citation = await prisma.citation.create({
      data: {
        reviewVersionId,
        localCitationId: "citation-conflict",
        doi: "10.1000/conflict",
        pmid: "12345",
      },
    });
    await prisma.claimEvidenceRelation.create({
      data: { claimId, citationId: citation.id, relationType: "contextualizes" },
    });

    const report = await prisma.$transaction((tx) =>
      materializeCanonicalReviewGraph(tx, reviewVersionId),
    );
    expect(report.workIdentityConflictCount).toBe(1);
    const resolved = await prisma.citation.findUniqueOrThrow({
      where: { id: citation.id },
      include: { knowledgeNode: true, workIdentityConflict: true },
    });
    expect(resolved.knowledgeNode).toMatchObject({
      stableKey: `work-occurrence:${citation.id}`,
      repositoryId: null,
      kind: "work",
    });
    expect(resolved.knowledgeNodeId).not.toBe(doiWork.id);
    expect(resolved.knowledgeNodeId).not.toBe(pmidWork.id);
    expect(resolved.workIdentityConflict).toMatchObject({
      reason: "incompatible-or-ambiguous-alias-set",
    });
  });

  it("preserves an explicit legacy claim-node identity and adds only its exact occurrence", async () => {
    const node = await prisma.knowledgeNode.create({
      data: {
        repositoryId,
        localNodeId: "explicit-claim-node",
        kind: "claim",
        versions: {
          create: {
            snapshotId,
            title: "Explicit repository claim",
            contributorsJson: "[]",
            license: "CC-BY-4.0",
            provenanceJson: '{"sourcePath":"claims.json"}',
            payloadJson: '{"statement":"Explicit claim","qualifiers":[]}',
          },
        },
      },
    });
    const claim = await prisma.claim.create({
      data: {
        reviewVersionId,
        knowledgeNodeId: node.id,
        localClaimId: "claim-explicit",
        text: "Explicitly bound legacy claim.",
        normalizedText: "explicitly bound legacy claim.",
      },
    });

    await prisma.$transaction((tx) => materializeCanonicalReviewGraph(tx, reviewVersionId));
    const rebound = await prisma.claim.findUniqueOrThrow({
      where: { id: claim.id },
      include: { graphVersion: true },
    });
    expect(rebound.knowledgeNodeId).toBe(node.id);
    expect(rebound.graphVersion).toMatchObject({
      knowledgeNodeId: node.id,
      sourceClaimId: claim.id,
      snapshotId: null,
    });
  });
});
