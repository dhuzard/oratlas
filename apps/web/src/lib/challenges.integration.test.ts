import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";
import type * as Challenges from "./challenges";

vi.mock("server-only", () => ({}));

const fileName = `.tmp-oratlas-challenges-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = `file:./${fileName}`;
let prisma: PrismaClient;
let service: typeof Challenges;

const challenger = {
  id: "",
  githubLogin: "challenger",
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  role: "USER" as const,
};
const author = {
  id: "",
  githubLogin: "review-author",
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  role: "USER" as const,
};
const editor = {
  id: "",
  githubLogin: "challenge-editor",
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  role: "EDITOR" as const,
};

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
  service = await import("./challenges");
  for (const actor of [challenger, author, editor]) {
    const row = await prisma.user.create({
      data: { githubLogin: actor.githubLogin, githubUserId: actor.githubLogin, role: actor.role },
    });
    actor.id = row.id;
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`])
    if (existsSync(path)) rmSync(path);
});

async function fixture(suffix: string) {
  const repository = await prisma.repository.create({
    data: {
      owner: "challenge-lab",
      name: `review-${suffix}`,
      canonicalUrl: `https://github.com/challenge-lab/review-${suffix}`,
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
      slug: `challenge-${suffix}`,
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
      title: "Challenge fixture",
      status: "published",
    },
  });
  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: "Challenge fixture",
      metadataJson: "{}",
      publishedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });
  const person = await prisma.person.create({
    data: { displayName: "Review Author", githubLogin: author.githubLogin },
  });
  await prisma.reviewContributor.create({
    data: {
      reviewVersionId: version.id,
      personId: person.id,
      rolesJson: '["author"]',
      position: 0,
    },
  });
  const claim = await prisma.claim.create({
    data: {
      reviewVersionId: version.id,
      localClaimId: "claim-1",
      text: "A bounded claim.",
      normalizedText: "a bounded claim",
    },
  });
  const citation = await prisma.citation.create({
    data: { reviewVersionId: version.id, localCitationId: "ref-1", title: "Evidence" },
  });
  const relation = await prisma.claimEvidenceRelation.create({
    data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
  });
  const assessment = await prisma.trustAssessment.create({
    data: {
      claimEvidenceRelationId: relation.id,
      protocolVersion: "trust-v1",
      assessorType: "human",
      assessorId: "reviewer",
      entailment: '{"rating":"high","status":"assessed"}',
    },
  });
  return { review, version, claim, relation, assessment };
}

describe.sequential("formal challenge persistence and lifecycle", () => {
  it("files an attributed challenge without mutating its exact subject", async () => {
    const seeded = await fixture("one");
    const subject = {
      type: "assessment-criterion" as const,
      assessmentId: seeded.assessment.id,
      criterion: "entailment",
    };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const before = await prisma.trustAssessment.findUniqueOrThrow({
      where: { id: seeded.assessment.id },
    });
    const created = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject,
      canonicalSubjectHash: binding.hash,
      grounds: "entailment",
      body: "<script>not HTML</script> The evidence does not entail the claim.",
    });
    expect(
      await prisma.trustAssessment.findUniqueOrThrow({ where: { id: seeded.assessment.id } }),
    ).toEqual(before);
    expect(
      await prisma.challengeTransition.findMany({ where: { challengeId: created.id } }),
    ).toMatchObject([{ fromStatus: null, toStatus: "open", actorId: challenger.id, revision: 0 }]);
    expect(
      await prisma.auditEvent.findFirst({
        where: { subjectId: created.id, action: "challenge.filed" },
      }),
    ).not.toBeNull();
    const listed = await service.listChallenges(seeded.review.slug, seeded.version.id);
    expect(listed?.challenges[0]).toMatchObject({
      id: created.id,
      body: "<script>not HTML</script> The evidence does not entail the claim.",
      subjectType: "assessment-criterion",
      status: "open",
    });
  });

  it("rejects a mismatched canonical hash and every illegal or unauthorized transition", async () => {
    const seeded = await fixture("two");
    const subject = { type: "claim" as const, claimId: seeded.claim.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    await expect(
      service.createChallenge(seeded.review.slug, challenger, {
        reviewVersionId: seeded.version.id,
        subject,
        canonicalSubjectHash: "0".repeat(64),
        grounds: "identity",
        body: "Wrong binding",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const created = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject,
      canonicalSubjectHash: binding.hash,
      grounds: "methodology",
      body: "Please address this method.",
    });
    await expect(
      service.transitionChallenge(created.id, editor, {
        expectedRevision: 0,
        toStatus: "resolved",
        rationale: "Too early",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.transitionChallenge(created.id, challenger, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.transitionChallenge(created.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).resolves.toEqual({ revision: 1, status: "author-responded" });
    await expect(
      service.transitionChallenge(created.id, challenger, {
        expectedRevision: 1,
        toStatus: "resolved",
        rationale: "I decide",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.transitionChallenge(created.id, editor, {
        expectedRevision: 1,
        toStatus: "resolved",
      }),
    ).rejects.toMatchObject({ code: "bad-request" });
    await expect(
      service.transitionChallenge(created.id, editor, {
        expectedRevision: 1,
        toStatus: "resolved",
        rationale: "The exact objection was addressed.",
      }),
    ).resolves.toEqual({ revision: 2, status: "resolved" });
    expect(await prisma.challengeTransition.count({ where: { challengeId: created.id } })).toBe(3);
    expect(await prisma.auditEvent.count({ where: { subjectId: created.id } })).toBe(3);
  });

  it("fails closed after target tampering", async () => {
    const seeded = await fixture("three");
    const subject = { type: "relation" as const, relationId: seeded.relation.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const created = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject,
      canonicalSubjectHash: binding.hash,
      grounds: "source-access",
      body: "The source is unavailable.",
    });
    await prisma.claimEvidenceRelation.update({
      where: { id: seeded.relation.id },
      data: { relationType: "contradicts" },
    });
    expect(
      (await service.listChallenges(seeded.review.slug, seeded.version.id))?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(created.id, challenger, {
        expectedRevision: 0,
        toStatus: "withdrawn",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("closes reads and lifecycle writes when the immutable version loses publication eligibility", async () => {
    const seeded = await fixture("four");
    const subject = { type: "claim" as const, claimId: seeded.claim.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const created = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject,
      canonicalSubjectHash: binding.hash,
      grounds: "other",
      body: "This exact published subject needs clarification.",
    });
    await prisma.reviewVersion.update({
      where: { id: seeded.version.id },
      data: { publishedAt: null },
    });
    expect(await service.listChallenges(seeded.review.slug, seeded.version.id)).toBeNull();
    expect(await service.listChallengeSubjectOptions(seeded.version.id)).toEqual([]);
    await expect(
      service.transitionChallenge(created.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
