import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";
import type * as Challenges from "./challenges";

vi.mock("server-only", () => ({}));

const externalDatabaseUrl = process.env.CHALLENGE_TEST_DATABASE_URL;
const fileName = `.tmp-oratlas-challenges-${process.pid}-${Date.now()}.db`;
const databasePath = externalDatabaseUrl
  ? undefined
  : resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = externalDatabaseUrl ?? `file:./${fileName}`;
const databaseSchema = externalDatabaseUrl
  ? "packages/db/prisma/schema.postgres.prisma"
  : "packages/db/prisma/schema.prisma";
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

async function createActor(suffix: string) {
  const row = await prisma.user.create({
    data: {
      githubLogin: `challenge-actor-${suffix}`,
      githubUserId: `challenge-actor-${suffix}`,
    },
  });
  return {
    id: row.id,
    githubLogin: row.githubLogin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    profileUrl: row.profileUrl,
    role: "USER" as const,
  };
}

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
      [prismaCli, "db", "push", "--schema", databaseSchema, "--skip-generate"],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
    );
  } catch (error) {
    if (process.platform !== "win32" || !databasePath) throw error;
    const ddl = execFileSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        databaseSchema,
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
  if (databasePath) {
    for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`])
      if (existsSync(path)) rmSync(path);
  }
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
  return { review, version, claim, citation, relation, assessment };
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
    const storedChallenge = await prisma.challenge.findUniqueOrThrow({ where: { id: created.id } });
    expect(
      await prisma.challengeTransition.findMany({ where: { challengeId: created.id } }),
    ).toMatchObject([
      {
        fromStatus: null,
        toStatus: "open",
        actorId: challenger.id,
        filedContentHash: storedChallenge.filedContentHash,
        revision: 0,
      },
    ]);
    const filingAudit = await prisma.auditEvent.findFirst({
      where: { subjectId: created.id, action: "challenge.filed" },
    });
    expect(filingAudit?.detailsJson).toContain(storedChallenge.filedContentHash);
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
      service.transitionChallenge(created.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "bad-request" });
    await expect(
      service.createChallengeResponse(created.id, challenger, {
        expectedRevision: 0,
        body: "Not a contributor response.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.createChallengeResponse(created.id, author, {
        expectedRevision: 0,
        body: "The contributor addresses the exact method objection.",
      }),
    ).resolves.toMatchObject({ revision: 1, status: "author-responded" });
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
    expect(
      await prisma.auditEvent.count({ where: { action: "challenge.response-created" } }),
    ).toBeGreaterThan(0);
  });

  it("records the full response, moderation, tombstone, resolution, queue, and audit exchange", async () => {
    const seeded = await fixture("exchange");
    const subject = { type: "claim" as const, claimId: seeded.claim.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const challengeText = "<img src=x onerror=alert(1)> retained challenge bytes";
    const responseText = "<script>alert(2)</script> retained response bytes";
    const privateRationale = "PRIVATE-EDITORIAL-RESOLUTION-RATIONALE";
    const created = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject,
      canonicalSubjectHash: binding.hash,
      grounds: "entailment",
      body: challengeText,
    });

    const response = await service.createChallengeResponse(created.id, author, {
      expectedRevision: 0,
      body: responseText,
    });
    const queue = await service.listOpenChallengePage();
    expect(queue.items.find(({ id }) => id === created.id)).toMatchObject({
      status: "author-responded",
      challengeHref: `/reviews/${seeded.review.slug}/versions/${seeded.version.id}#challenge-${created.id}`,
    });
    const firstQueuePage = await service.listOpenChallengePage(undefined, 1);
    expect(firstQueuePage.items).toHaveLength(1);
    expect(firstQueuePage.nextCursor).toBeTruthy();
    const secondQueuePage = await service.listOpenChallengePage(firstQueuePage.nextCursor!, 1);
    expect(secondQueuePage.items.map(({ id }) => id)).not.toContain(firstQueuePage.items[0]!.id);

    await expect(
      service.removeChallengeResponseContent(response.id, challenger, {
        expectedContentRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const moderationRace = await Promise.allSettled([
      service.removeChallengeResponseContent(response.id, editor, { expectedContentRevision: 0 }),
      service.removeChallengeResponseContent(response.id, editor, { expectedContentRevision: 0 }),
    ]);
    expect(moderationRace.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(moderationRace.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(
      service.removeChallengeContent(created.id, author, { expectedContentRevision: 0 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await service.removeChallengeContent(created.id, editor, { expectedContentRevision: 0 });
    await service.transitionChallenge(created.id, editor, {
      expectedRevision: 1,
      toStatus: "resolved",
      rationale: privateRationale,
    });

    const retained = await prisma.challenge.findUniqueOrThrow({
      where: { id: created.id },
      include: { response: true, transitions: { orderBy: { revision: "asc" } } },
    });
    expect(retained).toMatchObject({
      body: challengeText,
      contentStatus: "removed",
      removedById: editor.id,
    });
    expect(retained.response).toMatchObject({
      body: responseText,
      contentStatus: "removed",
      removedById: editor.id,
    });
    expect(retained.transitions.at(-1)?.rationale).toBe(privateRationale);

    const publicRow = (await service.listChallenges(seeded.review.slug, seeded.version.id))!
      .challenges[0]!;
    expect(publicRow).toMatchObject({ body: "", contentStatus: "removed", status: "resolved" });
    expect(publicRow.response).toMatchObject({ body: "", contentStatus: "removed" });
    const serialized = JSON.stringify(publicRow);
    for (const privateValue of [
      challengeText,
      responseText,
      privateRationale,
      editor.id,
      "EDITOR",
      "contributorRoles",
      "rolesJsonSnapshot",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(await service.listOpenChallengePage()).not.toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ id: created.id })]),
      }),
    );
    for (const action of [
      "challenge.filed",
      "challenge.response-created",
      "challenge.content-removed",
      "challenge.response-removed",
      "challenge.transitioned",
    ]) {
      expect(await prisma.auditEvent.count({ where: { action } })).toBeGreaterThan(0);
    }
  });

  it("fails closed when the response row or its transition hash/actor binding is missing or tampered", async () => {
    async function responded(suffix: string) {
      const seeded = await fixture(`response-integrity-${suffix}`);
      const subject = { type: "claim" as const, claimId: seeded.claim.id };
      const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
      const challenge = await service.createChallenge(seeded.review.slug, challenger, {
        reviewVersionId: seeded.version.id,
        subject,
        canonicalSubjectHash: binding.hash,
        grounds: "other",
        body: `Response integrity ${suffix}.`,
      });
      const response = await service.createChallengeResponse(challenge.id, author, {
        expectedRevision: 0,
        body: `Valid immutable response ${suffix}.`,
      });
      expect(
        (await service.listChallenges(seeded.review.slug, seeded.version.id))?.challenges,
      ).toHaveLength(1);
      return { seeded, challenge, response };
    }

    const deleted = await responded("deleted");
    await prisma.challengeResponse.delete({ where: { id: deleted.response.id } });
    expect(
      (await service.listChallenges(deleted.seeded.review.slug, deleted.seeded.version.id))
        ?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(deleted.challenge.id, editor, {
        expectedRevision: 1,
        toStatus: "resolved",
        rationale: "Must fail without the bound response.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const contentTamper = await responded("content-hash");
    await prisma.challengeResponse.update({
      where: { id: contentTamper.response.id },
      data: { contentHash: "0".repeat(64) },
    });
    expect(
      (
        await service.listChallenges(
          contentTamper.seeded.review.slug,
          contentTamper.seeded.version.id,
        )
      )?.challenges,
    ).toEqual([]);

    const transitionTamper = await responded("transition-hash");
    await prisma.challengeTransition.update({
      where: {
        challengeId_revision: { challengeId: transitionTamper.challenge.id, revision: 1 },
      },
      data: { responseContentHash: "f".repeat(64), actorId: challenger.id },
    });
    expect(
      (
        await service.listChallenges(
          transitionTamper.seeded.review.slug,
          transitionTamper.seeded.version.id,
        )
      )?.challenges,
    ).toEqual([]);
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

  it("rejects cross-version claims, relation endpoints, and assessment criteria", async () => {
    const first = await fixture("cross-a");
    const second = await fixture("cross-b");
    await expect(
      service.resolveChallengeSubject(prisma, second.version.id, {
        type: "claim",
        claimId: first.claim.id,
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    const relation = await prisma.claimEvidenceRelation.create({
      data: {
        claimId: first.claim.id,
        citationId: second.citation.id,
        relationType: "supports",
      },
    });
    await expect(
      service.resolveChallengeSubject(prisma, first.version.id, {
        type: "relation",
        relationId: relation.id,
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    const assessment = await prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: relation.id,
        protocolVersion: "trust-v1",
        assessorType: "human",
        entailment: '{"rating":"high","status":"assessed"}',
      },
    });
    await expect(
      service.resolveChallengeSubject(prisma, first.version.id, {
        type: "assessment-criterion",
        assessmentId: assessment.id,
        criterion: "entailment",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("binds all semantic bytes and fails closed when each target type mutates", async () => {
    const claimFixture = await fixture("mutate-claim");
    const claimSubject = { type: "claim" as const, claimId: claimFixture.claim.id };
    const claimBinding = await service.resolveChallengeSubject(
      prisma,
      claimFixture.version.id,
      claimSubject,
    );
    const claimChallenge = await service.createChallenge(claimFixture.review.slug, challenger, {
      reviewVersionId: claimFixture.version.id,
      subject: claimSubject,
      canonicalSubjectHash: claimBinding.hash,
      grounds: "methodology",
      body: "The declared scope is material.",
    });
    await prisma.claim.update({
      where: { id: claimFixture.claim.id },
      data: { scopeJson: '{"population":"changed"}' },
    });
    expect(
      (await service.listChallenges(claimFixture.review.slug, claimFixture.version.id))?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(claimChallenge.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const relationFixture = await fixture("mutate-relation");
    const relationSubject = {
      type: "relation" as const,
      relationId: relationFixture.relation.id,
    };
    const relationBinding = await service.resolveChallengeSubject(
      prisma,
      relationFixture.version.id,
      relationSubject,
    );
    const relationChallenge = await service.createChallenge(
      relationFixture.review.slug,
      challenger,
      {
        reviewVersionId: relationFixture.version.id,
        subject: relationSubject,
        canonicalSubjectHash: relationBinding.hash,
        grounds: "identity",
        body: "The exact citation identity is material.",
      },
    );
    await prisma.citation.update({
      where: { id: relationFixture.citation.id },
      data: { doi: "10.1000/changed" },
    });
    expect(
      (await service.listChallenges(relationFixture.review.slug, relationFixture.version.id))
        ?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(relationChallenge.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const assessmentFixture = await fixture("mutate-assessment");
    const assessmentSubject = {
      type: "assessment-criterion" as const,
      assessmentId: assessmentFixture.assessment.id,
      criterion: "entailment",
    };
    const assessmentBinding = await service.resolveChallengeSubject(
      prisma,
      assessmentFixture.version.id,
      assessmentSubject,
    );
    const assessmentChallenge = await service.createChallenge(
      assessmentFixture.review.slug,
      challenger,
      {
        reviewVersionId: assessmentFixture.version.id,
        subject: assessmentSubject,
        canonicalSubjectHash: assessmentBinding.hash,
        grounds: "entailment",
        body: "The assessed criterion is material.",
      },
    );
    await prisma.trustAssessment.update({
      where: { id: assessmentFixture.assessment.id },
      data: { protocolVersion: "trust-v2" },
    });
    expect(
      (await service.listChallenges(assessmentFixture.review.slug, assessmentFixture.version.id))
        ?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(assessmentChallenge.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("advertises and accepts only persisted contract-valid criterion instances", async () => {
    const seeded = await fixture("criteria");
    const options = await service.listChallengeSubjectOptions(seeded.version.id);
    expect(
      options
        .filter((option) => option.subject.type === "assessment-criterion")
        .map((option) => option.subject),
    ).toEqual([
      {
        type: "assessment-criterion",
        assessmentId: seeded.assessment.id,
        criterion: "entailment",
      },
    ]);
    await expect(
      service.resolveChallengeSubject(prisma, seeded.version.id, {
        type: "assessment-criterion",
        assessmentId: seeded.assessment.id,
        criterion: "sourceAccess",
      }),
    ).rejects.toMatchObject({ code: "not-found" });

    await prisma.trustAssessment.update({
      where: { id: seeded.assessment.id },
      data: { sourceAccess: '{"rating":"not-assessed","status":"not-assessed"}' },
    });
    await expect(
      service.resolveChallengeSubject(prisma, seeded.version.id, {
        type: "assessment-criterion",
        assessmentId: seeded.assessment.id,
        criterion: "sourceAccess",
      }),
    ).resolves.toMatchObject({ type: "assessment-criterion", criterion: "sourceAccess" });

    await prisma.trustAssessment.update({
      where: { id: seeded.assessment.id },
      data: { sourceAccess: '{"rating":"invented","status":"assessed"}' },
    });
    await expect(
      service.resolveChallengeSubject(prisma, seeded.version.id, {
        type: "assessment-criterion",
        assessmentId: seeded.assessment.id,
        criterion: "sourceAccess",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await service.listChallengeSubjectOptions(seeded.version.id)).some(
        (option) =>
          option.subject.type === "assessment-criterion" &&
          option.subject.criterion === "sourceAccess",
      ),
    ).toBe(false);
  });

  it("fails closed for filed-content and lifecycle-ledger tampering", async () => {
    const contentFixture = await fixture("ledger-content");
    const contentSubject = { type: "claim" as const, claimId: contentFixture.claim.id };
    const contentBinding = await service.resolveChallengeSubject(
      prisma,
      contentFixture.version.id,
      contentSubject,
    );
    const contentChallenge = await service.createChallenge(contentFixture.review.slug, challenger, {
      reviewVersionId: contentFixture.version.id,
      subject: contentSubject,
      canonicalSubjectHash: contentBinding.hash,
      grounds: "other",
      body: "Immutable filed text.",
    });
    await prisma.challenge.update({
      where: { id: contentChallenge.id },
      data: { body: "Tampered filed text." },
    });
    expect(
      (await service.listChallenges(contentFixture.review.slug, contentFixture.version.id))
        ?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(contentChallenge.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const deletedFixture = await fixture("ledger-deleted");
    const deletedSubject = { type: "claim" as const, claimId: deletedFixture.claim.id };
    const deletedBinding = await service.resolveChallengeSubject(
      prisma,
      deletedFixture.version.id,
      deletedSubject,
    );
    const deletedChallenge = await service.createChallenge(deletedFixture.review.slug, challenger, {
      reviewVersionId: deletedFixture.version.id,
      subject: deletedSubject,
      canonicalSubjectHash: deletedBinding.hash,
      grounds: "other",
      body: "Ledger deletion must fail closed.",
    });
    await prisma.challengeTransition.deleteMany({ where: { challengeId: deletedChallenge.id } });
    expect(
      (await service.listChallenges(deletedFixture.review.slug, deletedFixture.version.id))
        ?.challenges,
    ).toEqual([]);

    const extraFixture = await fixture("ledger-extra");
    const extraSubject = { type: "claim" as const, claimId: extraFixture.claim.id };
    const extraBinding = await service.resolveChallengeSubject(
      prisma,
      extraFixture.version.id,
      extraSubject,
    );
    const extraChallenge = await service.createChallenge(extraFixture.review.slug, challenger, {
      reviewVersionId: extraFixture.version.id,
      subject: extraSubject,
      canonicalSubjectHash: extraBinding.hash,
      grounds: "other",
      body: "Extra ledger rows must fail closed.",
    });
    const stored = await prisma.challenge.findUniqueOrThrow({ where: { id: extraChallenge.id } });
    await prisma.challengeTransition.create({
      data: {
        challengeId: extraChallenge.id,
        fromStatus: "open",
        toStatus: "author-responded",
        actorId: author.id,
        actorRoleSnapshot: author.role,
        filedContentHash: stored.filedContentHash,
        revision: 1,
      },
    });
    expect(
      (await service.listChallenges(extraFixture.review.slug, extraFixture.version.id))?.challenges,
    ).toEqual([]);

    const tamperedFixture = await fixture("ledger-tampered");
    const tamperedSubject = { type: "claim" as const, claimId: tamperedFixture.claim.id };
    const tamperedBinding = await service.resolveChallengeSubject(
      prisma,
      tamperedFixture.version.id,
      tamperedSubject,
    );
    const tamperedChallenge = await service.createChallenge(
      tamperedFixture.review.slug,
      challenger,
      {
        reviewVersionId: tamperedFixture.version.id,
        subject: tamperedSubject,
        canonicalSubjectHash: tamperedBinding.hash,
        grounds: "other",
        body: "Ledger status tampering must fail closed.",
      },
    );
    await prisma.challengeTransition.update({
      where: { challengeId_revision: { challengeId: tamperedChallenge.id, revision: 0 } },
      data: { toStatus: "invented", actorRoleSnapshot: "INVENTED" },
    });
    expect(
      (await service.listChallenges(tamperedFixture.review.slug, tamperedFixture.version.id))
        ?.challenges,
    ).toEqual([]);
    await expect(
      service.transitionChallenge(tamperedChallenge.id, author, {
        expectedRevision: 0,
        toStatus: "author-responded",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("covers dismissal, withdrawal, terminal rejection, and concurrent CAS", async () => {
    const seeded = await fixture("edges");
    const subject = { type: "claim" as const, claimId: seeded.claim.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const file = (body: string) =>
      service.createChallenge(seeded.review.slug, challenger, {
        reviewVersionId: seeded.version.id,
        subject,
        canonicalSubjectHash: binding.hash,
        grounds: "other",
        body,
      });

    const dismissed = await file("Dismiss this after response.");
    await service.createChallengeResponse(dismissed.id, author, {
      expectedRevision: 0,
      body: "A bounded contributor response for dismissal.",
    });
    await expect(
      service.transitionChallenge(dismissed.id, editor, {
        expectedRevision: 1,
        toStatus: "dismissed",
        rationale: "The objection is outside the bounded subject.",
      }),
    ).resolves.toEqual({ revision: 2, status: "dismissed" });
    await expect(
      service.transitionChallenge(dismissed.id, challenger, {
        expectedRevision: 2,
        toStatus: "withdrawn",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const withdrawn = await file("Withdraw this after response.");
    await service.createChallengeResponse(withdrawn.id, author, {
      expectedRevision: 0,
      body: "A bounded contributor response before withdrawal.",
    });
    await expect(
      service.transitionChallenge(withdrawn.id, challenger, {
        expectedRevision: 1,
        toStatus: "withdrawn",
      }),
    ).resolves.toEqual({ revision: 2, status: "withdrawn" });

    const raced = await file("Only one response transition may win.");
    const results = await Promise.allSettled([
      service.createChallengeResponse(raced.id, author, {
        expectedRevision: 0,
        body: "Concurrent response A.",
      }),
      service.createChallengeResponse(raced.id, author, {
        expectedRevision: 0,
        body: "Concurrent response B.",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.challengeTransition.count({ where: { challengeId: raced.id } })).toBe(2);
  });

  it("rejects concurrent duplicate active challenges and releases the key at a terminal state", async () => {
    const seeded = await fixture("duplicate-control");
    const subject = { type: "claim" as const, claimId: seeded.claim.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const input = {
      reviewVersionId: seeded.version.id,
      subject,
      canonicalSubjectHash: binding.hash,
      grounds: "methodology" as const,
      body: "The exact method needs clarification.",
    };

    const outcomes = await Promise.allSettled([
      service.createChallenge(seeded.review.slug, challenger, input),
      service.createChallenge(seeded.review.slug, challenger, input),
    ]);
    const successes = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<{ id: string }> =>
        outcome.status === "fulfilled",
    );
    const failures = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toMatchObject({
      code: "conflict",
      message: "You already have an active challenge for this exact subject.",
    });
    expect(await prisma.challenge.count({ where: { canonicalSubjectHash: binding.hash } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "challenge.filed", subjectId: successes[0]!.value.id },
      }),
    ).toBe(1);

    const created = successes[0]!.value;
    await service.createChallengeResponse(created.id, author, {
      expectedRevision: 0,
      body: "The active-key response.",
    });
    await expect(
      service.createChallenge(seeded.review.slug, challenger, input),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.transitionChallenge(created.id, editor, {
      expectedRevision: 1,
      toStatus: "dismissed",
      rationale: "The objection has been reviewed and closed.",
    });
    await expect(service.createChallenge(seeded.review.slug, challenger, input)).resolves.toEqual({
      id: expect.any(String),
    });
  });

  it("adopts pre-J03 active rows without hiding them or blocking their lifecycle", async () => {
    const seeded = await fixture("legacy-active-keys");
    const claimSubject = { type: "claim" as const, claimId: seeded.claim.id };
    const relationSubject = { type: "relation" as const, relationId: seeded.relation.id };
    const claimBinding = await service.resolveChallengeSubject(
      prisma,
      seeded.version.id,
      claimSubject,
    );
    const relationBinding = await service.resolveChallengeSubject(
      prisma,
      seeded.version.id,
      relationSubject,
    );
    const open = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject: claimSubject,
      canonicalSubjectHash: claimBinding.hash,
      grounds: "identity",
      body: "Legacy open challenge.",
    });
    const responded = await service.createChallenge(seeded.review.slug, challenger, {
      reviewVersionId: seeded.version.id,
      subject: relationSubject,
      canonicalSubjectHash: relationBinding.hash,
      grounds: "source-access",
      body: "Legacy responded challenge.",
    });
    await service.createChallengeResponse(responded.id, author, {
      expectedRevision: 0,
      body: "Legacy response content.",
    });
    await prisma.challenge.updateMany({
      where: { id: { in: [open.id, responded.id] } },
      data: { activeChallengerSubjectKey: null },
    });
    const original = await prisma.challenge.findUniqueOrThrow({ where: { id: open.id } });
    const legacyDuplicate = await prisma.challenge.create({
      data: {
        reviewVersionId: original.reviewVersionId,
        subjectType: original.subjectType,
        claimId: original.claimId,
        claimEvidenceRelationId: original.claimEvidenceRelationId,
        trustAssessmentId: original.trustAssessmentId,
        criterion: original.criterion,
        subjectRefJson: original.subjectRefJson,
        canonicalSubjectHash: original.canonicalSubjectHash,
        grounds: original.grounds,
        body: original.body,
        filedContentHash: original.filedContentHash,
        challengerId: original.challengerId,
      },
    });
    await prisma.challengeTransition.create({
      data: {
        challengeId: legacyDuplicate.id,
        fromStatus: null,
        toStatus: "open",
        actorId: challenger.id,
        actorRoleSnapshot: challenger.role,
        filedContentHash: original.filedContentHash,
        revision: 0,
      },
    });

    const listed = await service.listChallenges(seeded.review.slug, seeded.version.id);
    expect(listed?.challenges.map(({ id }) => id)).toEqual(
      expect.arrayContaining([open.id, responded.id, legacyDuplicate.id]),
    );
    const adopted = await prisma.challenge.findMany({
      where: { id: { in: [open.id, responded.id, legacyDuplicate.id] } },
      orderBy: { id: "asc" },
      select: { id: true, activeChallengerSubjectKey: true },
    });
    expect(adopted.find((row) => row.id === open.id)?.activeChallengerSubjectKey).not.toBeNull();
    expect(
      adopted.find((row) => row.id === responded.id)?.activeChallengerSubjectKey,
    ).not.toBeNull();
    expect(
      adopted.find((row) => row.id === legacyDuplicate.id)?.activeChallengerSubjectKey,
    ).toBeNull();

    await expect(
      service.createChallenge(seeded.review.slug, challenger, {
        reviewVersionId: seeded.version.id,
        subject: claimSubject,
        canonicalSubjectHash: claimBinding.hash,
        grounds: "other",
        body: "A duplicate of the legacy active challenge.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.createChallengeResponse(open.id, author, {
        expectedRevision: 0,
        body: "Adopted open response.",
      }),
    ).resolves.toMatchObject({ revision: 1, status: "author-responded" });
    await service.transitionChallenge(responded.id, editor, {
      expectedRevision: 1,
      toStatus: "resolved",
      rationale: "The legacy exchange is complete.",
    });
    expect(
      await prisma.challenge.findUniqueOrThrow({
        where: { id: responded.id },
        select: { activeChallengerSubjectKey: true },
      }),
    ).toEqual({ activeChallengerSubjectKey: null });
    await expect(
      service.createChallengeResponse(legacyDuplicate.id, author, {
        expectedRevision: 0,
        body: "Legacy duplicate response.",
      }),
    ).resolves.toMatchObject({ revision: 1, status: "author-responded" });
  });

  it("caps active challenges per exact subject under a concurrent boundary race without rejection audits", async () => {
    const seeded = await fixture("subject-cap");
    const subject = { type: "claim" as const, claimId: seeded.claim.id };
    const binding = await service.resolveChallengeSubject(prisma, seeded.version.id, subject);
    const actors = await Promise.all(
      Array.from({ length: service.MAX_ACTIVE_CHALLENGES_PER_SUBJECT + 1 }, (_, index) =>
        createActor(`cap-${index}`),
      ),
    );
    const file = (actor: (typeof actors)[number]) =>
      service.createChallenge(seeded.review.slug, actor, {
        reviewVersionId: seeded.version.id,
        subject,
        canonicalSubjectHash: binding.hash,
        grounds: "other",
        body: `Independent objection from ${actor.githubLogin}.`,
      });

    for (const actor of actors.slice(0, service.MAX_ACTIVE_CHALLENGES_PER_SUBJECT - 1)) {
      await file(actor);
    }
    const auditCountBeforeBoundary = await prisma.auditEvent.count({
      where: { action: "challenge.filed" },
    });
    const boundary = await Promise.allSettled(actors.slice(-2).map(file));
    expect(boundary.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = boundary.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "rate-limited",
      message: "This exact subject already has the maximum number of active challenges.",
    });
    expect(
      await prisma.challenge.count({
        where: {
          canonicalSubjectHash: binding.hash,
          status: { in: ["open", "author-responded"] },
        },
      }),
    ).toBe(service.MAX_ACTIVE_CHALLENGES_PER_SUBJECT);
    expect(await prisma.auditEvent.count({ where: { action: "challenge.filed" } })).toBe(
      auditCountBeforeBoundary + 1,
    );
  });
});
