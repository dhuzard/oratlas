import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "./index.js";
import { materializeCanonicalReviewGraph } from "./canonical-graph-materialization.js";

// Uses the deployed PostgreSQL schema/guards and generated PostgreSQL client,
// exactly like publication-boundary.postgres.integration.test.ts.
const enabled = Boolean(process.env.CANONICAL_GRAPH_MATERIALIZATION_TEST_DATABASE_URL);
const prisma = getPrisma();
const suffix = `${Date.now()}-${process.pid}`;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe.skipIf(!enabled)("batched canonical review materialization on PostgreSQL", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("preserves exact graph IDs, compatibility bindings and assessment bytes on replay", async () => {
    const repository = await prisma.repository.create({
      data: {
        owner: "synthetic-materialization",
        name: suffix,
        canonicalUrl: `https://github.com/synthetic-materialization/${suffix}`,
        githubRepositoryId: `synthetic-materialization-${suffix}`,
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
        slug: `synthetic-materialization-${suffix}`,
        repositoryId: repository.id,
        currentSnapshotId: snapshot.id,
        title: "Synthetic PostgreSQL batching fixture",
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
      },
    });
    const claimIds = [0, 1].map((index) => `pg-batch-claim-${suffix}-${index}`);
    const citationIds = [0, 1].map((index) => `pg-batch-citation-${suffix}-${index}`);
    await prisma.claim.createMany({
      data: claimIds.map((id, index) => ({
        id,
        reviewVersionId: version.id,
        localClaimId: `claim-${index}`,
        text: `Synthetic claim ${index}.`,
        normalizedText: `synthetic claim ${index}.`,
      })),
    });
    await prisma.citation.createMany({
      data: citationIds.map((id, index) => ({
        id,
        reviewVersionId: version.id,
        localCitationId: `citation-${index}`,
        doi: `10.5555/pg-batch-${suffix}-${index}`,
        title: `Synthetic work ${index}`,
        authorsJson: '["Synthetic Author"]',
      })),
    });
    const relationIds = [0, 1, 2].map((index) => `pg-batch-relation-${suffix}-${index}`);
    await prisma.claimEvidenceRelation.createMany({
      data: relationIds.map((id, index) => ({
        id,
        claimId: claimIds[index % 2]!,
        citationId: citationIds[Math.floor(index / 2)]!,
        relationType: "supports",
      })),
    });
    const assessment = await prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: relationIds[0]!,
        protocolVersion: "TRUST-1.0",
        assessorType: "agent",
        evidenceJson: '{"synthetic":true}',
      },
    });
    const assessmentDigest = digest(assessment);
    const run = () =>
      prisma.$transaction((tx) => materializeCanonicalReviewGraph(tx, version.id), {
        isolationLevel: "Serializable",
      });
    const readState = async () => {
      const claims = await prisma.claim.findMany({
        where: { reviewVersionId: version.id },
        include: { graphVersion: true },
        orderBy: { id: "asc" },
      });
      const citations = await prisma.citation.findMany({
        where: { reviewVersionId: version.id },
        include: { graphVersion: true },
        orderBy: { id: "asc" },
      });
      const relations = await prisma.claimEvidenceRelation.findMany({
        where: { id: { in: relationIds } },
        include: { nodeEdge: true },
        orderBy: { id: "asc" },
      });
      const versions = await prisma.knowledgeNodeVersion.findMany({
        where: {
          OR: [
            { sourceReviewVersionId: version.id },
            { sourceClaimId: { in: claimIds } },
            { sourceCitationId: { in: citationIds } },
          ],
        },
        orderBy: { id: "asc" },
      });
      const edges = await prisma.nodeEdge.findMany({
        where: { sourceNodeVersionId: { in: versions.map(({ id }) => id) } },
        orderBy: { id: "asc" },
      });
      return { claims, citations, relations, versions, edges };
    };

    const first = await run();
    expect(first).toMatchObject({
      claimCount: 2,
      reviewAssertionEdgeCount: 2,
      workCount: 2,
      evidenceEdgeCount: 3,
      workIdentityConflictCount: 0,
    });
    const before = await readState();
    expect(before.versions).toHaveLength(5);
    expect(before.edges).toHaveLength(5);
    expect(before.claims.every((row) => row.knowledgeNodeId && row.graphVersion)).toBe(true);
    expect(before.citations.every((row) => row.knowledgeNodeId && row.graphVersion)).toBe(true);
    expect(before.relations.every((row) => row.nodeEdgeId && row.nodeEdge)).toBe(true);
    expect(await run()).toEqual(first);
    expect(await readState()).toEqual(before);
    expect(
      digest(await prisma.trustAssessment.findUniqueOrThrow({ where: { id: assessment.id } })),
    ).toBe(assessmentDigest);
  });
});
