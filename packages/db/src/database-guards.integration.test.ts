import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client/index.js";
import {
  applyDatabaseGuards,
  baselineSchemaUrl,
  DATABASE_GUARD_NAMES,
  getPrisma,
  POSTGRES_DATABASE_GUARD_TRIGGER_NAMES,
} from "./index.js";

const enabled = Boolean(process.env.DATABASE_GUARD_TEST_DATABASE_URL);
const prisma = getPrisma();
let contractPrisma: PrismaClient | undefined;
let contractSchema: string | undefined;

function runPrismaInSchema(databaseUrl: string, args: string[]): void {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(executable, ["exec", "prisma", ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Isolated contract migration failed: ${result.stderr || result.stdout}`);
  }
}

describe.skipIf(!enabled)("PostgreSQL database guards", () => {
  beforeAll(async () => {
    contractSchema = `oratlas_baseline_${randomBytes(10).toString("hex")}`;
    const databaseUrl = baselineSchemaUrl(
      process.env.DATABASE_GUARD_TEST_DATABASE_URL!,
      contractSchema,
    );
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${contractSchema}"`);
    runPrismaInSchema(databaseUrl, [
      "db",
      "execute",
      "--file",
      "prisma/baseline/20260805000000_existing_schema_baseline.sql",
      "--schema",
      "prisma/schema.postgres.prisma",
    ]);
    runPrismaInSchema(databaseUrl, [
      "migrate",
      "resolve",
      "--applied",
      "20260805000000_existing_schema_baseline",
      "--schema",
      "prisma/schema.postgres.prisma",
    ]);
    runPrismaInSchema(databaseUrl, [
      "migrate",
      "deploy",
      "--schema",
      "prisma/schema.postgres.prisma",
    ]);
    contractPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
  }, 60_000);

  afterAll(async () => {
    await contractPrisma?.$disconnect();
    if (contractSchema) await prisma.$executeRawUnsafe(`DROP SCHEMA "${contractSchema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("validates final deferred state and keeps later finalization repeatable", async () => {
    const client = contractPrisma!;
    const first = await client.$queryRaw<Array<{ activated: boolean }>>`
      SELECT "oratlas_finalize_canonical_graph_contract"(
        ${"backupRuns/first"}, ${"a".repeat(64)}
      ) AS activated
    `;
    expect(first[0]?.activated).toBe(true);
    const second = await client.$queryRaw<Array<{ activated: boolean }>>`
      SELECT "oratlas_finalize_canonical_graph_contract"(
        ${"backupRuns/later"}, ${"b".repeat(64)}
      ) AS activated
    `;
    expect(second[0]?.activated).toBe(false);
    const state = await client.canonicalGraphContractState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.backupId).toBe("backupRuns/first");
    expect(state.manifestDigest).toBe("a".repeat(64));

    await expect(
      client.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "Review" ("id", "slug", "title", "status", "updatedAt")
          VALUES ('deferred-valid-review', 'deferred-valid-review', 'Deferred valid', 'published', CURRENT_TIMESTAMP)
        `;
        await tx.$executeRaw`
          INSERT INTO "KnowledgeNode" ("id", "stableKey", "originType", "localNodeId", "kind")
          VALUES ('deferred-valid-node', 'review:deferred-valid-review', 'review-record', 'deferred-valid-review', 'review')
        `;
        await tx.$executeRaw`
          UPDATE "Review" SET "knowledgeNodeId" = 'deferred-valid-node'
          WHERE "id" = 'deferred-valid-review'
        `;
      }),
    ).resolves.toBeUndefined();

    await expect(
      client.$executeRaw`DELETE FROM "KnowledgeNode" WHERE "id" = 'deferred-valid-node'`,
    ).rejects.toThrow(/canonical graph contract/i);
    await expect(
      client.$executeRaw`DELETE FROM "CanonicalGraphContractState" WHERE "id" = 1`,
    ).rejects.toThrow(/cannot be deleted/i);

    await expect(
      client.$executeRaw`
        INSERT INTO "Review" ("id", "slug", "title", "status", "updatedAt")
        VALUES ('deferred-invalid-review', 'deferred-invalid-review', 'Deferred invalid', 'published', CURRENT_TIMESTAMP)
      `,
    ).rejects.toThrow(/canonical graph contract/i);

    await expect(
      client.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "Review" ("id", "slug", "title", "status", "updatedAt")
          VALUES ('deferred-transient-review', 'deferred-transient-review', 'Transient', 'published', CURRENT_TIMESTAMP)
        `;
        await tx.$executeRaw`DELETE FROM "Review" WHERE "id" = 'deferred-transient-review'`;
      }),
    ).resolves.toBeUndefined();
  }, 60_000);

  it("installs every constraint and trigger and rejects invalid direct writes", async () => {
    await applyDatabaseGuards(prisma, "postgresql");
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
    `;
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([...DATABASE_GUARD_NAMES]),
    );
    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
    `;
    expect(triggers.map(({ tgname }) => tgname)).toEqual(
      expect.arrayContaining([...POSTGRES_DATABASE_GUARD_TRIGGER_NAMES]),
    );
    const immutableDeleteTriggers = await prisma.$queryRaw<
      Array<{ tgname: string; definition: string }>
    >`
      SELECT tgname, pg_get_triggerdef(oid) AS definition
      FROM pg_trigger
      WHERE tgname IN ('DecisionLetter_immutable_delete_guard', 'EditorialDecisionProvenance_immutable_delete_guard')
    `;
    expect(immutableDeleteTriggers).toHaveLength(2);
    expect(
      immutableDeleteTriggers.every(({ definition }) => definition.includes("BEFORE DELETE")),
    ).toBe(true);

    await expect(
      prisma.review.create({
        data: {
          slug: `invalid-synthesis-${Date.now()}`,
          title: "Invalid synthesis",
          reviewType: "ai-synthesis",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.synthesisGenerationRequestClaim.create({
        data: {
          key: `invalid-claim-${Date.now()}`,
          requestKey: `invalid-request-${Date.now()}`,
          selectorJson: "{}",
          selectorHash: "a".repeat(64),
          status: "running",
        },
      }),
    ).rejects.toThrow();

    const suffix = `${Date.now()}`;
    const actor = await prisma.user.create({
      data: { githubLogin: `guard-${suffix}`, githubUserId: `guard-${suffix}` },
    });
    const repository = await prisma.repository.create({
      data: {
        owner: "guard",
        name: suffix,
        canonicalUrl: `https://github.com/guard/${suffix}`,
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
        slug: `guard-${suffix}`,
        repositoryId: repository.id,
        currentSnapshotId: snapshot.id,
        title: "Guard fixture",
        status: "published",
      },
    });
    const version = await prisma.reviewVersion.create({
      data: {
        reviewId: review.id,
        snapshotId: snapshot.id,
        title: review.title,
        metadataJson: "{}",
      },
    });
    const claim = await prisma.claim.create({
      data: {
        reviewVersionId: version.id,
        localClaimId: "claim",
        text: "Claim",
        normalizedText: "claim",
      },
    });
    const citation = await prisma.citation.create({
      data: { reviewVersionId: version.id, localCitationId: "citation" },
    });
    const relation = await prisma.claimEvidenceRelation.create({
      data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
    });
    const [sourceNode, targetNode] = await Promise.all([
      prisma.knowledgeNode.create({
        data: { repositoryId: repository.id, localNodeId: "source", kind: "claim" },
      }),
      prisma.knowledgeNode.create({
        data: { repositoryId: repository.id, localNodeId: "target", kind: "dataset" },
      }),
    ]);
    const [sourceVersion, targetVersion] = await Promise.all([
      prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: sourceNode.id,
          snapshotId: snapshot.id,
          title: "Source",
          license: "CC-BY-4.0",
          provenanceJson: "{}",
          payloadJson: '{"statement":"Source","qualifiers":[]}',
        },
      }),
      prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: targetNode.id,
          snapshotId: snapshot.id,
          title: "Target",
          license: "CC-BY-4.0",
          provenanceJson: "{}",
          payloadJson: '{"artifactPath":"data.csv","format":"text/csv"}',
        },
      }),
    ]);
    const proposal = await prisma.nodeEdgeProposal.create({
      data: {
        originKey: `guard-${suffix}`,
        sourceStableKey: "source",
        targetStableKey: "target",
        sourceNodeVersionId: sourceVersion.id,
        targetNodeId: targetNode.id,
        targetNodeVersionId: targetVersion.id,
        relationType: "uses-dataset",
        origin: "asserted-by-author",
      },
    });
    const adjudicationBase = {
      protocolVersion: "trust-v2",
      outcome: "disagreement-upheld",
      adjudicatorId: actor.id,
      adjudicatorRoleSnapshot: "EDITOR",
      adjudicatorGithubLoginSnapshot: actor.githubLogin,
      rationale: "Private guard rationale",
      rationaleHash: "c".repeat(64),
      disagreementHash: "d".repeat(64),
      outcomeHash: "e".repeat(64),
    };
    const claimAdjudication = await prisma.trustAdjudication.create({
      data: {
        ...adjudicationBase,
        subjectType: "claim-citation",
        claimEvidenceRelationId: relation.id,
      },
    });
    const nodeAdjudication = await prisma.trustAdjudication.create({
      data: {
        ...adjudicationBase,
        subjectType: "node-relation",
        claimEvidenceRelationId: null,
        nodeEdgeProposalId: proposal.id,
        disagreementHash: "f".repeat(64),
      },
    });
    const challengeBase = {
      subjectType: "adjudication",
      subjectRefJson: "{}",
      canonicalSubjectHash: "1".repeat(64),
      grounds: "other",
      body: "Guard fixture",
      filedContentHash: "2".repeat(64),
      challengerId: actor.id,
    };
    await expect(
      prisma.challenge.create({
        data: {
          ...challengeBase,
          reviewVersionId: version.id,
          nodeEdgeProposalId: proposal.id,
          trustAdjudicationId: claimAdjudication.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.challenge.create({
        data: { ...challengeBase, trustAdjudicationId: claimAdjudication.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.challenge.create({
        data: {
          ...challengeBase,
          nodeEdgeProposalId: proposal.id,
          trustAdjudicationId: claimAdjudication.id,
        },
      }),
    ).rejects.toThrow();
    const [reviewChallenge, nodeChallenge] = await Promise.all([
      prisma.challenge.create({
        data: {
          ...challengeBase,
          reviewVersionId: version.id,
          trustAdjudicationId: claimAdjudication.id,
        },
      }),
      prisma.challenge.create({
        data: {
          ...challengeBase,
          canonicalSubjectHash: "3".repeat(64),
          nodeEdgeProposalId: proposal.id,
          trustAdjudicationId: nodeAdjudication.id,
        },
      }),
    ]);
    const person = await prisma.person.create({ data: { displayName: "Guard person" } });
    const responseBase = {
      responderId: actor.id,
      responderRoleSnapshot: "USER",
      responderGithubLoginSnapshot: actor.githubLogin,
      contributorGithubLoginSnapshot: actor.githubLogin,
      contributorDisplayNameSnapshot: "Guard actor",
      contributorRolesJsonSnapshot: "[]",
      body: "Guard response",
      contentHash: "4".repeat(64),
    };
    await expect(
      prisma.challengeResponse.create({
        data: {
          ...responseBase,
          challengeId: reviewChallenge.id,
          contributorPersonId: person.id,
          nodeContributorUserId: actor.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.challengeResponse.create({
        data: { ...responseBase, challengeId: reviewChallenge.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.challengeResponse.create({
        data: { ...responseBase, challengeId: reviewChallenge.id, nodeContributorUserId: actor.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.challengeResponse.create({
        data: { ...responseBase, challengeId: nodeChallenge.id, contributorPersonId: person.id },
      }),
    ).rejects.toThrow();
  });
});
