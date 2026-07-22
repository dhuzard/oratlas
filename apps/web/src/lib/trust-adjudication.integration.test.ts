import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";
import { canonicalJson } from "@oratlas/contracts";
import type {
  createTrustAdjudication,
  listTrustDisagreementQueue,
  setTrustAdjudicatorDesignation,
} from "./trust-adjudication";
import type {
  createChallenge,
  listChallengeSubjectOptions,
  listChallenges,
  resolveChallengeSubject,
} from "./challenges";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-trust-adjudication-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;

type Actor = { id: string; githubLogin: string; role: string };
type Runtime = {
  prisma: PrismaClient;
  create: typeof createTrustAdjudication;
  list: typeof listTrustDisagreementQueue;
  designate: typeof setTrustAdjudicatorDesignation;
  createChallenge: typeof createChallenge;
  challengeOptions: typeof listChallengeSubjectOptions;
  listChallenges: typeof listChallenges;
  resolveChallengeSubject: typeof resolveChallengeSubject;
};

let runtime: Runtime;
let admin: Actor;
let editor: Actor;
let designated: Actor;
let repositoryId: string;
let snapshotId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  writeFileSync(databasePath, "");
  const prismaArgs = [
    "db",
    "push",
    "--schema",
    "packages/db/prisma/schema.prisma",
    "--skip-generate",
  ];
  execFileSync(
    process.platform === "win32"
      ? process.execPath
      : resolve(process.cwd(), "packages/db/node_modules/.bin/prisma"),
    process.platform === "win32"
      ? [resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"), ...prismaArgs]
      : prismaArgs,
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
  );
  const { prisma } = await import("./db");
  const service = await import("./trust-adjudication");
  const challenges = await import("./challenges");
  runtime = {
    prisma,
    create: service.createTrustAdjudication,
    list: service.listTrustDisagreementQueue,
    designate: service.setTrustAdjudicatorDesignation,
    createChallenge: challenges.createChallenge,
    challengeOptions: challenges.listChallengeSubjectOptions,
    listChallenges: challenges.listChallenges,
    resolveChallengeSubject: challenges.resolveChallengeSubject,
  };
  const [adminRow, editorRow, designatedRow] = await Promise.all([
    prisma.user.create({
      data: { githubUserId: "d02-admin", githubLogin: "d02-admin", role: "ADMIN" },
    }),
    prisma.user.create({
      data: { githubUserId: "d02-editor", githubLogin: "d02-editor", role: "EDITOR" },
    }),
    prisma.user.create({
      data: { githubUserId: "d02-designated", githubLogin: "d02-designated", role: "USER" },
    }),
  ]);
  admin = { id: adminRow.id, githubLogin: adminRow.githubLogin, role: adminRow.role };
  editor = { id: editorRow.id, githubLogin: editorRow.githubLogin, role: editorRow.role };
  designated = {
    id: designatedRow.id,
    githubLogin: designatedRow.githubLogin,
    role: designatedRow.role,
  };
  const repository = await prisma.repository.create({
    data: {
      githubRepositoryId: "d02-repository",
      canonicalUrl: "https://github.com/example/d02",
      owner: "example",
      name: "d02",
      defaultBranch: "main",
    },
  });
  repositoryId = repository.id;
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId,
      commitSha: "a".repeat(40),
      sourceTreeSha: "b".repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "c".repeat(64),
    },
  });
  snapshotId = snapshot.id;
}, 30_000);

afterAll(async () => {
  await runtime?.prisma.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

async function disagreementFixture(
  suffix: string,
  assessorIds: [string, string] = [`${suffix}-a`, `${suffix}-b`],
) {
  const review =
    (await runtime.prisma.review.findFirst({ where: { repositoryId } })) ??
    (await runtime.prisma.review.create({
      data: {
        slug: "d02-adjudication-fixtures",
        repositoryId,
        currentSnapshotId: snapshotId,
        title: "D02 adjudication fixtures",
        status: "published",
      },
    }));
  const version = await runtime.prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId,
      title: review.title,
      metadataJson: "{}",
      publishedAt: new Date("2026-07-22T00:00:00.000Z"),
    },
  });
  const claim = await runtime.prisma.claim.create({
    data: {
      reviewVersionId: version.id,
      localClaimId: "claim-1",
      text: "Claim",
      normalizedText: "claim",
    },
  });
  const citation = await runtime.prisma.citation.create({
    data: { reviewVersionId: version.id, localCitationId: "citation-1" },
  });
  const relation = await runtime.prisma.claimEvidenceRelation.create({
    data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
  });
  const assessments = await Promise.all(
    (["high", "low"] as const).map((rating, index) =>
      runtime.prisma.trustAssessment.create({
        data: {
          claimEvidenceRelationId: relation.id,
          protocolVersion: "trust-v2",
          assessorType: "human",
          assessorId: assessorIds[index],
          entailment: JSON.stringify({ rating, status: "assessed" }),
        },
      }),
    ),
  );
  const queue = await runtime.list({ reviewVersionId: version.id });
  const disagreement = queue.find((item) => item.subjectId === relation.id && item.current);
  expect(disagreement).toBeDefined();
  return { review, version, relation, assessments, disagreement: disagreement! };
}

function input(fixture: Awaited<ReturnType<typeof disagreementFixture>>) {
  return {
    subjectType: "claim-citation" as const,
    assessmentIds: fixture.assessments.map(({ id }) => id),
    expectedDisagreementHash: fixture.disagreement.disagreementHash,
    outcome: "disagreement-upheld" as const,
    rationale: "A private rationale that is long enough for the adjudication contract.",
    conflictOfInterest: { status: "none-declared" as const },
    administratorOverride: false,
  };
}

describe.sequential("TRUST adjudication persistence", () => {
  it("creates an immutable public-minimal record, retries idempotently, and rejects a conflicting outcome", async () => {
    const fixture = await disagreementFixture("create");
    const created = await runtime.create(editor, input(fixture));
    expect(created).toMatchObject({
      outcome: "disagreement-upheld",
      valid: true,
      adjudicator: { githubLogin: editor.githubLogin },
    });
    expect(created).not.toHaveProperty("rationale");
    await expect(runtime.create(editor, input(fixture))).resolves.toEqual(created);
    await expect(
      runtime.create(editor, { ...input(fixture), outcome: "reassessment-requested" }),
    ).rejects.toThrow(/different immutable adjudication/i);
  });

  it("invalidates late, mixed-subject references and a selected assessment outside the sealed set", async () => {
    const fixture = await disagreementFixture("reference-seal");
    const other = await disagreementFixture("reference-seal-other");
    const adjudication = await runtime.create(editor, input(fixture));
    const otherSnapshot = other.disagreement.assessments[0]!;
    await runtime.prisma.trustAdjudicationReference.create({
      data: {
        adjudicationId: adjudication.id,
        position: 2,
        assessmentId: otherSnapshot.id,
        assessmentHash: otherSnapshot.hash,
        trustAssessmentId: otherSnapshot.id,
      },
    });
    expect(
      (await runtime.list({ reviewVersionId: fixture.version.id }))
        .flatMap(({ adjudications }) => adjudications)
        .find(({ id }) => id === adjudication.id),
    ).toMatchObject({ valid: false });
    await runtime.prisma.trustAdjudicationReference.delete({
      where: { adjudicationId_position: { adjudicationId: adjudication.id, position: 2 } },
    });
    await runtime.prisma.trustAdjudication.update({
      where: { id: adjudication.id },
      data: { selectedAssessmentId: "not-a-referenced-assessment" },
    });
    expect(
      (await runtime.list({ reviewVersionId: fixture.version.id }))
        .flatMap(({ adjudications }) => adjudications)
        .find(({ id }) => id === adjudication.id),
    ).toMatchObject({ valid: false });
    await runtime.prisma.trustAdjudication.update({
      where: { id: adjudication.id },
      data: { selectedAssessmentId: null },
    });
  });

  it("grants explicit designated authority without granting an editor role", async () => {
    const fixture = await disagreementFixture("designated");
    await expect(runtime.create(designated, input(fixture))).rejects.toThrow(/authority required/i);
    await runtime.designate(admin, designated.id, true);
    await expect(runtime.create(designated, input(fixture))).resolves.toMatchObject({
      adjudicator: { githubLogin: designated.githubLogin },
    });
  });

  it("enforces direct-involvement recusal and permits only a declared ADMIN override", async () => {
    const editorFixture = await disagreementFixture("editor-recusal", [
      editor.githubLogin,
      "independent",
    ]);
    await expect(runtime.create(editor, input(editorFixture))).rejects.toThrow(/recusal/i);

    const challengerFixture = await disagreementFixture("challenger-recusal");
    const relationOption = (await runtime.challengeOptions(challengerFixture.version.id)).find(
      ({ subject }) =>
        subject.type === "relation" && subject.relationId === challengerFixture.relation.id,
    );
    await runtime.createChallenge(
      challengerFixture.review.slug,
      {
        ...editor,
        role: "EDITOR",
        displayName: null,
        avatarUrl: null,
        profileUrl: null,
      },
      {
        reviewVersionId: challengerFixture.version.id,
        subject: { type: "relation", relationId: challengerFixture.relation.id },
        canonicalSubjectHash: relationOption!.canonicalSubjectHash,
        grounds: "other",
        body: "This relation challenge creates direct adjudication involvement.",
      },
    );
    await expect(runtime.create(editor, input(challengerFixture))).rejects.toThrow(/recusal/i);

    const adminFixture = await disagreementFixture("admin-override", [
      admin.githubLogin,
      "independent",
    ]);
    await expect(runtime.create(admin, input(adminFixture))).rejects.toThrow(/recusal/i);
    await expect(
      runtime.create(admin, {
        ...input(adminFixture),
        administratorOverride: true,
        conflictOfInterest: { status: "conflict-declared" },
      }),
    ).resolves.toMatchObject({
      conflictOfInterest: { status: "conflict-declared" },
      administratorOverride: { administrator: { githubLogin: admin.githubLogin } },
    });
  });

  it("keeps superseded history valid/non-alerting and fails closed on tampering", async () => {
    const fixture = await disagreementFixture("history");
    const adjudication = await runtime.create(editor, input(fixture));
    const successor = await runtime.prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: fixture.relation.id,
        protocolVersion: "trust-v2",
        assessorType: "human",
        assessorId: fixture.assessments[0]!.assessorId,
        entailment: JSON.stringify({ rating: "moderate", status: "assessed" }),
        sourceRecordHash: "d".repeat(64),
        sourceLineageKey: "history-lineage",
        supersedesAssessmentId: fixture.assessments[0]!.id,
      },
    });
    const afterSupersession = await runtime.list({ reviewVersionId: fixture.version.id });
    expect(afterSupersession).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ current: true, open: true }),
        expect.objectContaining({
          current: false,
          open: false,
          adjudications: [expect.objectContaining({ id: adjudication.id, valid: true })],
        }),
      ]),
    );
    await runtime.prisma.trustAssessment.update({
      where: { id: fixture.assessments[0]!.id },
      data: { entailment: JSON.stringify({ rating: "very-high", status: "assessed" }) },
    });
    const afterTamper = await runtime.list({ reviewVersionId: fixture.version.id });
    expect(
      afterTamper
        .flatMap(({ adjudications }) => adjudications)
        .find(({ id }) => id === adjudication.id),
    ).toMatchObject({ valid: false });
    expect(successor.id).toBeTruthy();
  });

  it("files a hash-bound public challenge against a claim-citation adjudication", async () => {
    const fixture = await disagreementFixture("challenge-adjudication");
    const adjudication = await runtime.create(editor, input(fixture));
    const option = (await runtime.challengeOptions(fixture.version.id)).find(
      ({ subject }) =>
        subject.type === "adjudication" && subject.adjudicationId === adjudication.id,
    );
    expect(option).toBeDefined();
    const challenge = await runtime.createChallenge(
      fixture.review.slug,
      {
        ...designated,
        role: "USER",
        displayName: null,
        avatarUrl: null,
        profileUrl: null,
      },
      {
        reviewVersionId: fixture.version.id,
        subject: { type: "adjudication", adjudicationId: adjudication.id },
        canonicalSubjectHash: option!.canonicalSubjectHash,
        grounds: "other",
        body: "The immutable adjudication outcome itself should be reconsidered.",
      },
    );
    expect(challenge.id).toBeTruthy();
    const stored = await runtime.prisma.challenge.findUniqueOrThrow({
      where: { id: challenge.id },
    });
    expect(stored).toMatchObject({
      subjectType: "adjudication",
      trustAdjudicationId: adjudication.id,
      canonicalSubjectHash: option!.canonicalSubjectHash,
    });
    expect(
      (await runtime.listChallenges(fixture.review.slug, fixture.version.id))?.challenges,
    ).toEqual([
      expect.objectContaining({
        id: challenge.id,
        subjectType: "adjudication",
        subjectHref: expect.stringContaining(`#adjudication-${adjudication.id}`),
      }),
    ]);
    const originalOutcomeHash = adjudication.outcomeHash;
    await runtime.prisma.trustAdjudication.update({
      where: { id: adjudication.id },
      data: { outcomeHash: "f".repeat(64) },
    });
    const changed = await runtime.resolveChallengeSubject(runtime.prisma, fixture.version.id, {
      type: "adjudication",
      adjudicationId: adjudication.id,
    });
    expect(changed.hash).not.toBe(option!.canonicalSubjectHash);
    await runtime.prisma.trustAdjudication.update({
      where: { id: adjudication.id },
      data: { outcomeHash: originalOutcomeHash },
    });
  });

  it("creates and integrity-checks a node-relation adjudication", async () => {
    const [sourceNode, targetNode] = await Promise.all([
      runtime.prisma.knowledgeNode.create({
        data: { repositoryId, localNodeId: "d02-node-claim", kind: "claim" },
      }),
      runtime.prisma.knowledgeNode.create({
        data: { repositoryId, localNodeId: "d02-node-data", kind: "dataset" },
      }),
    ]);
    const provenanceJson = JSON.stringify({
      sourcePath: "nodes.json",
      repositoryUrl: "https://github.com/example/d02",
      commitSha: "a".repeat(40),
    });
    const [sourceVersion, targetVersion] = await Promise.all([
      runtime.prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: sourceNode.id,
          snapshotId,
          title: "Node claim",
          text: "Node claim text",
          license: "CC-BY-4.0",
          provenanceJson,
          payloadJson: JSON.stringify({ statement: "Node claim text", qualifiers: [] }),
        },
      }),
      runtime.prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: targetNode.id,
          snapshotId,
          title: "Node dataset",
          license: "CC-BY-4.0",
          provenanceJson,
          payloadJson: JSON.stringify({ artifactPath: "data.csv", format: "text/csv" }),
        },
      }),
    ]);
    const proposal = await runtime.prisma.nodeEdgeProposal.create({
      data: {
        originKey: "d02-node-origin",
        sourceStableKey: canonicalJson({
          githubRepositoryId: "d02-repository",
          localNodeId: sourceNode.localNodeId,
          commitSha: "a".repeat(40),
        }),
        targetStableKey: canonicalJson({
          githubRepositoryId: "d02-repository",
          localNodeId: targetNode.localNodeId,
          commitSha: "a".repeat(40),
        }),
        sourceNodeVersionId: sourceVersion.id,
        targetNodeId: targetNode.id,
        targetNodeVersionId: targetVersion.id,
        relationType: "uses-dataset",
        origin: "asserted-by-author",
      },
    });
    const nodeAssessments = await Promise.all(
      (["high", "low"] as const).map((rating, index) =>
        runtime.prisma.nodeRelationTrustAssessment.create({
          data: {
            nodeEdgeProposalId: proposal.id,
            protocolVersion: "trust-v2",
            assessorType: "human",
            assessorId: `node-assessor-${index}`,
            sourceAccess: JSON.stringify({ rating, status: "assessed" }),
            sourceRecordJson: canonicalJson({
              subjectType: "node-relation",
              subject: {
                claimNodeId: sourceNode.localNodeId,
                evidenceNodeId: targetNode.localNodeId,
                evidenceKind: "dataset",
                relationType: "uses-dataset",
              },
              protocolVersion: "trust-v2",
              assessorType: "human",
              assessorId: `node-assessor-${index}`,
              criteria: { sourceAccess: { rating, status: "assessed" } },
              reviewStatus: "human-reviewed",
            }),
            sourceReviewStatus: "human-reviewed",
            sourceAssessorType: "human",
          },
        }),
      ),
    );
    const disagreement = (await runtime.list()).find(
      (item) => item.subjectType === "node-relation" && item.subjectId === proposal.id,
    );
    expect(disagreement).toBeDefined();
    const adjudication = await runtime.create(editor, {
      subjectType: "node-relation",
      assessmentIds: nodeAssessments.map(({ id }) => id),
      expectedDisagreementHash: disagreement!.disagreementHash,
      outcome: "disagreement-upheld",
      rationale: "The node relation assessments use incompatible explicit source ratings.",
      conflictOfInterest: { status: "none-declared" },
      administratorOverride: false,
    });
    expect(adjudication).toMatchObject({ subjectType: "node-relation", valid: true });
    await runtime.prisma.nodeRelationTrustAssessment.update({
      where: { id: nodeAssessments[0]!.id },
      data: { sourceAccess: JSON.stringify({ rating: "very-high", status: "assessed" }) },
    });
    expect(
      (await runtime.list())
        .flatMap(({ adjudications }) => adjudications)
        .find(({ id }) => id === adjudication.id),
    ).toMatchObject({ valid: false });
  });

  it("installs SQLite shape and append-only guards", async () => {
    const fixture = await disagreementFixture("guards");
    const adjudication = await runtime.create(editor, input(fixture));
    await applyDatabaseGuards(runtime.prisma, "sqlite");
    await expect(
      runtime.prisma.trustAdjudication.update({
        where: { id: adjudication.id },
        data: { outcome: "reassessment-requested" },
      }),
    ).rejects.toThrow();
    await expect(
      runtime.prisma.trustAdjudication.delete({ where: { id: adjudication.id } }),
    ).rejects.toThrow();
    await expect(
      runtime.prisma.$executeRawUnsafe(
        `INSERT INTO "TrustAdjudicatorDesignation" ("id", "userId", "designatedById", "active", "createdAt", "revokedAt") VALUES (?, ?, ?, 0, ?, NULL)`,
        "bad-designation",
        designated.id,
        admin.id,
        new Date().toISOString(),
      ),
    ).rejects.toThrow(/database guard rejected invalid state/i);
    const mixed = await runtime.prisma.trustAssessment.findFirstOrThrow({
      where: { claimEvidenceRelationId: { not: fixture.relation.id } },
    });
    await expect(
      runtime.prisma.trustAdjudicationReference.create({
        data: {
          adjudicationId: adjudication.id,
          position: 2,
          assessmentId: mixed.id,
          assessmentHash: "a".repeat(64),
          trustAssessmentId: mixed.id,
        },
      }),
    ).rejects.toThrow();
  });
});
