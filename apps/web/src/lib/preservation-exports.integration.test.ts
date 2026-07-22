import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CompatibilityReport,
  type InspectionReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { createEmptyNodeExtractionReport, type FullExtraction } from "@oratlas/extractor";
import {
  bibtex,
  jats,
  provJsonLd,
  roCrate,
  scholarlyJson,
  scholarlyJsonDocument,
} from "@oratlas/exports";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";
import { type createInspectionCapture } from "./inspection-captures";
import { type acceptSubmission, type createSubmission } from "./submissions";
import { type getPreservedFileContent, type getVersionExportContext } from "./preservation";
import {
  type createChallenge,
  type createChallengeResponse,
  type listChallengeSubjectOptions,
  type removeChallengeContent,
  type removeChallengeResponseContent,
  type transitionChallenge,
} from "./challenges";
import {
  type createTrustAdjudication,
  type listTrustDisagreementQueue,
} from "./trust-adjudication";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-preservation-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;
const commitA = "a".repeat(40);
const treeA = "b".repeat(40);
const nowIso = "2026-07-12T08:00:00.000Z";
const readmeContent = "# Preserved Review\n\nBody with <markup> & special chars.\n";
const trustDocument = "# Computational Review TRUST v2\n\n<script>alert(1)</script>\n";
const fairDocument = "# FAIR\n\nSource-declared methodology.\n";

type Runtime = {
  prisma: PrismaClient;
  createInspectionCapture: typeof createInspectionCapture;
  createSubmission: typeof createSubmission;
  acceptSubmission: typeof acceptSubmission;
  getVersionExportContext: typeof getVersionExportContext;
  getPreservedFileContent: typeof getPreservedFileContent;
  createChallenge: typeof createChallenge;
  createChallengeResponse: typeof createChallengeResponse;
  listChallengeSubjectOptions: typeof listChallengeSubjectOptions;
  removeChallengeContent: typeof removeChallengeContent;
  removeChallengeResponseContent: typeof removeChallengeResponseContent;
  transitionChallenge: typeof transitionChallenge;
  createTrustAdjudication: typeof createTrustAdjudication;
  listTrustDisagreementQueue: typeof listTrustDisagreementQueue;
};

let runtime: Runtime;
let submitterId: string;
let editorId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
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
    {
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );
  const { prisma } = await import("./db");
  const captures = await import("./inspection-captures");
  const submissions = await import("./submissions");
  const preservation = await import("./preservation");
  const challenges = await import("./challenges");
  const adjudications = await import("./trust-adjudication");
  runtime = {
    prisma,
    createInspectionCapture: captures.createInspectionCapture,
    createSubmission: submissions.createSubmission,
    acceptSubmission: submissions.acceptSubmission,
    getVersionExportContext: preservation.getVersionExportContext,
    getPreservedFileContent: preservation.getPreservedFileContent,
    createChallenge: challenges.createChallenge,
    createChallengeResponse: challenges.createChallengeResponse,
    listChallengeSubjectOptions: challenges.listChallengeSubjectOptions,
    removeChallengeContent: challenges.removeChallengeContent,
    removeChallengeResponseContent: challenges.removeChallengeResponseContent,
    transitionChallenge: challenges.transitionChallenge,
    createTrustAdjudication: adjudications.createTrustAdjudication,
    listTrustDisagreementQueue: adjudications.listTrustDisagreementQueue,
  };
  const submitter = await prisma.user.create({
    data: { githubUserId: "pres-submitter", githubLogin: "pres-submitter", role: "USER" },
  });
  const editor = await prisma.user.create({
    data: { githubUserId: "pres-editor", githubLogin: "pres-editor", role: "EDITOR" },
  });
  submitterId = submitter.id;
  editorId = editor.id;
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

describe.sequential("preservation and standards exports", () => {
  it("keeps an accepted version exportable from the archive alone, including after upstream deletion", async () => {
    const capability = await runtime.createInspectionCapture(
      submitterId,
      inspectionReport(),
      fullExtraction(),
      validationReport(),
      new Date(),
    );
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(submission.submissionId, editorId);

    const review = await runtime.prisma.review.findUniqueOrThrow({
      where: { slug: accepted.reviewSlug },
      include: { versions: true },
    });
    const versionId = review.versions[0]!.id;
    const discussionSentinel = "OPEN-DISCUSSION-MUST-NOT-ENTER-SCHOLARLY-EXPORTS";
    await runtime.prisma.reviewComment.create({
      data: {
        reviewId: review.id,
        reviewVersionId: versionId,
        authorId: submitterId,
        kind: "concern",
        body: discussionSentinel,
      },
    });
    const contributorLogin = "E03-CONTRIBUTOR-IDENTITY-MUST-STAY-PRIVATE";
    const challengerLogin = "E03-CHALLENGER-IDENTITY-MUST-STAY-PRIVATE";
    const moderatorLogin = "E03-MODERATOR-IDENTITY-MUST-STAY-PRIVATE";
    const [contributorUser, challengerUser, moderatorUser] = await Promise.all([
      runtime.prisma.user.create({
        data: { githubUserId: "e03-contributor", githubLogin: contributorLogin },
      }),
      runtime.prisma.user.create({
        data: { githubUserId: "e03-challenger", githubLogin: challengerLogin },
      }),
      runtime.prisma.user.create({
        data: { githubUserId: "e03-moderator", githubLogin: moderatorLogin, role: "EDITOR" },
      }),
    ]);
    const contributorPerson = await runtime.prisma.person.create({
      data: {
        displayName: "E03-CONTRIBUTOR-DISPLAY-NAME-MUST-STAY-PRIVATE",
        githubLogin: contributorLogin,
      },
    });
    await runtime.prisma.reviewContributor.create({
      data: {
        reviewVersionId: versionId,
        personId: contributorPerson.id,
        rolesJson: '["E03-INTERNAL-CONTRIBUTOR-ROLE-MUST-STAY-PRIVATE"]',
        position: 0,
      },
    });
    const contributor = {
      id: contributorUser.id,
      githubLogin: contributorLogin,
      displayName: contributorPerson.displayName,
      avatarUrl: null,
      profileUrl: null,
      role: "USER" as const,
    };
    const challenger = {
      id: challengerUser.id,
      githubLogin: challengerLogin,
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
      role: "USER" as const,
    };
    const moderator = {
      id: moderatorUser.id,
      githubLogin: moderatorLogin,
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
      role: "EDITOR" as const,
    };
    const lifecycleSentinels = {
      openChallenge: "E03-OPEN-CHALLENGE-BODY-MUST-STAY-PRIVATE",
      respondedChallenge: "E03-RESPONDED-CHALLENGE-BODY-MUST-STAY-PRIVATE",
      respondedResponse: "E03-RESPONDED-RESPONSE-BODY-MUST-STAY-PRIVATE",
      removedChallenge: "E03-REMOVED-CHALLENGE-RETAINED-BYTES-MUST-STAY-PRIVATE",
      removedResponse: "E03-REMOVED-RESPONSE-RETAINED-BYTES-MUST-STAY-PRIVATE",
      rationale: "E03-PRIVATE-RESOLUTION-RATIONALE-MUST-STAY-PRIVATE",
    };
    const claims = await Promise.all(
      ["open", "responded", "resolved"].map((status) =>
        runtime.prisma.claim.create({
          data: {
            reviewVersionId: versionId,
            localClaimId: `e03-${status}-export-subject`,
            text: `A bounded ${status} subject used to verify challenge export isolation.`,
            normalizedText: `a bounded ${status} subject used to verify challenge export isolation`,
          },
        }),
      ),
    );
    const citation = await runtime.prisma.citation.create({
      data: {
        reviewVersionId: versionId,
        localCitationId: "i01-disagreement-source",
        title: "Independent assessment source",
      },
    });
    const relation = await runtime.prisma.claimEvidenceRelation.create({
      data: {
        claimId: claims[0]!.id,
        citationId: citation.id,
        relationType: "supports",
      },
    });
    const assessmentRows = await Promise.all(
      [
        { assessorId: "assessor-a", rating: "high" },
        { assessorId: "assessor-b", rating: "low" },
      ].map((assessment, index) =>
        runtime.prisma.trustAssessment.create({
          data: {
            claimEvidenceRelationId: relation.id,
            protocolVersion: "trust-v2",
            assessorType: "human",
            assessorId: assessment.assessorId,
            assessedAt: new Date(`2026-07-0${index + 1}T00:00:00.000Z`),
            conflictOfInterestStatus: index === 0 ? "conflict-declared" : "none-declared",
            entailment: JSON.stringify({ rating: assessment.rating, status: "assessed" }),
            limitationsJson: JSON.stringify([`Independent ${assessment.rating} assessment.`]),
          },
        }),
      ),
    );
    const disagreement = (await runtime.listTrustDisagreementQueue()).find(
      (item) => item.subjectId === relation.id && item.open,
    );
    expect(disagreement).toBeDefined();
    const adjudication = await runtime.createTrustAdjudication(
      { id: editorId, githubLogin: "pres-editor", role: "EDITOR" },
      {
        subjectType: "claim-citation",
        assessmentIds: assessmentRows.map(({ id }) => id),
        expectedDisagreementHash: disagreement!.disagreementHash,
        outcome: "disagreement-upheld",
        rationale: "PRIVATE-D02-ADJUDICATION-RATIONALE-MUST-NOT-EXPORT",
        conflictOfInterest: { status: "none-declared" },
        administratorOverride: false,
      },
    );
    expect(adjudication.valid).toBe(true);
    const challengeSubjects = await runtime.listChallengeSubjectOptions(versionId);
    const subjectFor = (claimId: string) =>
      challengeSubjects.find(
        ({ subject }) => subject.type === "claim" && subject.claimId === claimId,
      );
    const openSubject = subjectFor(claims[0]!.id);
    const respondedSubject = subjectFor(claims[1]!.id);
    const resolvedSubject = subjectFor(claims[2]!.id);
    expect([openSubject, respondedSubject, resolvedSubject]).not.toContain(undefined);
    const fileChallenge = (subject: NonNullable<typeof openSubject>, body: string) =>
      runtime.createChallenge(accepted.reviewSlug, challenger, {
        reviewVersionId: versionId,
        subject: subject.subject,
        canonicalSubjectHash: subject.canonicalSubjectHash,
        grounds: "methodology",
        body,
      });
    const openChallenge = await fileChallenge(openSubject!, lifecycleSentinels.openChallenge);
    const respondedChallenge = await fileChallenge(
      respondedSubject!,
      lifecycleSentinels.respondedChallenge,
    );
    const respondedResponse = await runtime.createChallengeResponse(
      respondedChallenge.id,
      contributor,
      { expectedRevision: 0, body: lifecycleSentinels.respondedResponse },
    );
    const resolvedChallenge = await fileChallenge(
      resolvedSubject!,
      lifecycleSentinels.removedChallenge,
    );
    const resolvedResponse = await runtime.createChallengeResponse(
      resolvedChallenge.id,
      contributor,
      { expectedRevision: 0, body: lifecycleSentinels.removedResponse },
    );
    await runtime.removeChallengeContent(resolvedChallenge.id, moderator, {
      expectedContentRevision: 0,
    });
    await runtime.removeChallengeResponseContent(resolvedResponse.id, moderator, {
      expectedContentRevision: 0,
    });
    await runtime.transitionChallenge(resolvedChallenge.id, moderator, {
      expectedRevision: 1,
      toStatus: "resolved",
      rationale: lifecycleSentinels.rationale,
    });
    // Amend the scholarly contributor record after the immutable response was
    // filed. Exports may include the current scholarly identity/role, but must
    // never leak the response's historical identity and role snapshots.
    await runtime.prisma.person.update({
      where: { id: contributorPerson.id },
      data: {
        displayName: "Current Public Contributor",
        githubLogin: "current-public-contributor",
      },
    });
    await runtime.prisma.reviewContributor.update({
      where: {
        reviewVersionId_personId: { reviewVersionId: versionId, personId: contributorPerson.id },
      },
      data: { rolesJson: '["author"]' },
    });
    const retained = await runtime.prisma.challenge.findUniqueOrThrow({
      where: { id: resolvedChallenge.id },
      include: { response: true, transitions: true },
    });
    expect(retained).toMatchObject({
      body: lifecycleSentinels.removedChallenge,
      contentStatus: "removed",
      status: "resolved",
    });
    expect(retained.response).toMatchObject({
      id: resolvedResponse.id,
      body: lifecycleSentinels.removedResponse,
      contentStatus: "removed",
    });
    expect(retained.transitions.map(({ toStatus }) => toStatus)).toEqual([
      "open",
      "author-responded",
      "resolved",
    ]);
    expect(retained.transitions.at(-1)?.rationale).toBe(lifecycleSentinels.rationale);

    // Simulate upstream deletion: nothing in the export path may consult the
    // network, so exports must be derivable purely from stored rows.
    await runtime.prisma.user.update({
      where: { id: editorId },
      data: { githubLogin: "renamed-pres-editor" },
    });
    const context = await runtime.getVersionExportContext(accepted.reviewSlug, versionId);
    await runtime.prisma.user.update({
      where: { id: editorId },
      data: { githubLogin: "pres-editor" },
    });
    expect(context).not.toBeNull();
    const { exportInput, provInput, manifest, scholarlyInput } = context!;

    expect(exportInput.platformVersion).toBe("0.1.0");
    expect(provInput.platformVersion).toBe("0.1.0");
    expect(manifest.platformVersion).toBe("0.1.0");
    expect(exportInput.commitSha).toBe(commitA);
    expect(exportInput.treeSha).toBe(treeA);
    expect(manifest.preservedContentAvailable).toBe(true);
    expect(manifest.swhids.revision).toBe(`swh:1:rev:${commitA}`);
    expect(manifest.swhids.directory).toBe(`swh:1:dir:${treeA}`);
    expect(manifest.integrity.capturePayloadHash).toBe(capability.payloadHash);

    const readme = manifest.files.find((file) => file.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.sha256).toBe(sha256(readmeContent));

    const preserved = await runtime.getPreservedFileContent(
      accepted.reviewSlug,
      versionId,
      "README.md",
    );
    expect(preserved?.content).toBe(readmeContent);
    expect(
      (await runtime.getPreservedFileContent(accepted.reviewSlug, versionId, "TRUST.md"))?.content,
    ).toBe(trustDocument);
    expect(
      (await runtime.getPreservedFileContent(accepted.reviewSlug, versionId, "FAIR.md"))?.content,
    ).toBe(fairDocument);
    const storedMetadata = JSON.parse(review.versions[0]!.metadataJson) as Record<string, unknown>;
    expect(storedMetadata.sourceAssessmentDocuments).toEqual(
      fullExtraction().sourceAssessmentDocuments,
    );

    const scholarly = scholarlyJson(scholarlyInput);
    expect(scholarlyInput.assessments).toHaveLength(2);
    expect(
      scholarlyInput.assessments.map((assessment) => assessment.criteria.entailment?.rating).sort(),
    ).toEqual(["high", "low"]);
    expect(
      scholarlyInput.assessments.map((assessment) => assessment.conflictOfInterest.status).sort(),
    ).toEqual(["conflict-declared", "none-declared"]);
    expect(scholarlyInput.disagreements).toHaveLength(1);
    expect(scholarlyInput.disagreements[0]).toMatchObject({ open: false, current: true });
    expect(scholarlyInput.adjudications).toHaveLength(1);
    expect(scholarlyInput.adjudications[0]).toMatchObject({
      outcome: "disagreement-upheld",
      adjudicator: { githubLogin: "pres-editor" },
      valid: true,
    });
    expect(scholarlyInput.challenges.map(({ status }) => status).sort()).toEqual([
      "author-responded",
      "open",
      "resolved",
    ]);
    expect(scholarlyInput.sourceDocuments.map(({ path }) => path)).toEqual(["TRUST.md", "FAIR.md"]);
    expect(scholarly).toContain(lifecycleSentinels.openChallenge);
    expect(scholarly).toContain(lifecycleSentinels.respondedResponse);
    expect(scholarly).not.toContain(lifecycleSentinels.removedChallenge);
    expect(scholarly).not.toContain(lifecycleSentinels.removedResponse);
    expect(scholarly).not.toContain(lifecycleSentinels.rationale);
    expect(scholarly).not.toContain(challengerUser.id);
    expect(scholarly).not.toContain(moderatorUser.id);
    expect(scholarly).not.toContain("PRIVATE-D02-ADJUDICATION-RATIONALE-MUST-NOT-EXPORT");
    expect(scholarly).not.toMatch(/"(?:roleSnapshot|actorId|crosswalk)":/i);

    const bib = bibtex(exportInput);
    expect(bib).toContain(`commit ${commitA}`);
    const jatsXml = jats(exportInput);
    expect(jatsXml).toContain("<journal-title>Open Review Atlas</journal-title>");
    const crate = roCrate({
      version: exportInput,
      files: manifest.files,
      snapshotContentHash: manifest.integrity.snapshotContentHash,
      capturePayloadHash: manifest.integrity.capturePayloadHash,
      scholarly: {
        url: `${exportInput.canonicalUrl.replace("/reviews/", "/api/reviews/")}/export/json`,
        document: scholarlyJsonDocument(scholarlyInput),
      },
    });
    expect(JSON.stringify(crate)).toContain(`swh:1:rev:${commitA}`);
    expect(JSON.stringify(crate)).toContain("TRUST assessment");
    expect(JSON.stringify(crate)).toContain("TRUST disagreement");
    expect(JSON.stringify(crate)).toContain("TRUST adjudication");
    expect(JSON.stringify(crate)).toContain(lifecycleSentinels.openChallenge);
    const prov = provJsonLd(provInput);
    const serializedProv = JSON.stringify(prov);
    expect(serializedProv).toContain(capability.payloadHash);
    expect(serializedProv).toContain("pres-editor");
    expect(serializedProv).not.toContain("renamed-pres-editor");
    const exportsByFormat = {
      bibtex: bib,
      jats: jatsXml,
      roCrate: JSON.stringify(crate),
      prov: serializedProv,
      manifest: JSON.stringify(manifest),
    };
    const challengeRows = await runtime.prisma.challenge.findMany({
      where: { id: { in: [openChallenge.id, respondedChallenge.id, resolvedChallenge.id] } },
      include: { response: true },
      orderBy: { status: "asc" },
    });
    expect(challengeRows.map(({ status }) => status).sort()).toEqual([
      "author-responded",
      "open",
      "resolved",
    ]);
    const challengeAuditDetails = (
      await runtime.prisma.auditEvent.findMany({
        where: {
          OR: [
            { subjectId: { in: [openChallenge.id, respondedChallenge.id, resolvedChallenge.id] } },
            { subjectId: { in: [respondedResponse.id, resolvedResponse.id] } },
          ],
        },
        select: { detailsJson: true },
      })
    ).map(({ detailsJson }) => detailsJson);
    const privateChallengeData = [
      discussionSentinel,
      lifecycleSentinels.removedChallenge,
      lifecycleSentinels.removedResponse,
      lifecycleSentinels.rationale,
      "E03-INTERNAL-CONTRIBUTOR-ROLE-MUST-STAY-PRIVATE",
      contributorUser.id,
      challengerUser.id,
      moderatorUser.id,
      ...challengeAuditDetails,
    ];
    for (const sentinel of privateChallengeData) {
      expect(
        Object.fromEntries(
          Object.entries(exportsByFormat).map(([format, value]) => [
            format,
            value.includes(sentinel),
          ]),
        ),
        `private challenge data leaked: ${sentinel}`,
      ).toEqual({ bibtex: false, jats: false, roCrate: false, prov: false, manifest: false });
    }
    const baselineFormats = {
      bibtex: bib,
      jats: jatsXml,
      prov: serializedProv,
      manifest: JSON.stringify(manifest),
    };
    for (const publicChallengeValue of [
      lifecycleSentinels.openChallenge,
      lifecycleSentinels.respondedChallenge,
      lifecycleSentinels.respondedResponse,
      contributorLogin,
      challengerLogin,
      moderatorLogin,
      contributorPerson.displayName,
      openChallenge.id,
      respondedChallenge.id,
      respondedResponse.id,
      resolvedChallenge.id,
      resolvedResponse.id,
      retained.filedContentHash,
      retained.response!.contentHash,
    ]) {
      expect(
        Object.values(baselineFormats).some((value) => value.includes(publicChallengeValue)),
        `baseline export included public challenge value: ${publicChallengeValue}`,
      ).toBe(false);
    }

    const successor = await runtime.prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: relation.id,
        protocolVersion: "trust-v2",
        assessorType: "human",
        assessorId: "assessor-a",
        assessedAt: new Date("2026-07-04T00:00:00.000Z"),
        entailment: JSON.stringify({ rating: "moderate", status: "assessed" }),
        limitationsJson: "[]",
        sourceRecordHash: "e".repeat(64),
        sourceLineageKey: "assessor-a-lineage",
        supersedesAssessmentId: assessmentRows[0]!.id,
      },
    });
    const afterSupersession = (await runtime.listTrustDisagreementQueue()).find(
      (item) =>
        item.subjectId === relation.id && item.assessments.some(({ id }) => id === successor.id),
    );
    expect(afterSupersession).toMatchObject({ open: true });
    const historicalAfterSupersession = (await runtime.listTrustDisagreementQueue()).find(
      (item) => !item.current && item.adjudications.some(({ id }) => id === adjudication.id),
    );
    expect(historicalAfterSupersession?.adjudications).toEqual([
      expect.objectContaining({ id: adjudication.id, valid: true }),
    ]);

    const declaredCitation = await runtime.prisma.citation.create({
      data: { reviewVersionId: versionId, localCitationId: "d02-declared-coi" },
    });
    const declaredRelation = await runtime.prisma.claimEvidenceRelation.create({
      data: { claimId: claims[1]!.id, citationId: declaredCitation.id, relationType: "supports" },
    });
    const declaredAssessments = await Promise.all(
      ["high", "low"].map((rating, index) =>
        runtime.prisma.trustAssessment.create({
          data: {
            claimEvidenceRelationId: declaredRelation.id,
            protocolVersion: "trust-v2",
            assessorType: "human",
            assessorId: `independent-${index}`,
            entailment: JSON.stringify({ rating, status: "assessed" }),
          },
        }),
      ),
    );
    const declaredDisagreement = (await runtime.listTrustDisagreementQueue()).find(
      (item) => item.subjectId === declaredRelation.id,
    );
    await expect(
      runtime.createTrustAdjudication(
        { id: editorId, githubLogin: "pres-editor", role: "EDITOR" },
        {
          subjectType: "claim-citation",
          assessmentIds: declaredAssessments.map(({ id }) => id),
          expectedDisagreementHash: declaredDisagreement!.disagreementHash,
          outcome: "disagreement-upheld",
          rationale: "A declared conflict snapshot alone is provenance, not direct involvement.",
          conflictOfInterest: { status: "conflict-declared" },
          administratorOverride: false,
        },
      ),
    ).resolves.toMatchObject({ conflictOfInterest: { status: "conflict-declared" } });

    const malformed = await runtime.prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: declaredRelation.id,
        protocolVersion: "trust-invalid",
        assessorType: "agent",
        entailment: "{malformed",
      },
    });
    await expect(runtime.listTrustDisagreementQueue()).rejects.toThrow(
      /criterion entailment is invalid/i,
    );
    await runtime.prisma.trustAssessment.delete({ where: { id: malformed.id } });
    await runtime.prisma.trustAssessment.update({
      where: { id: declaredAssessments[0]!.id },
      data: { conflictOfInterestStatus: "corrupt-status" },
    });
    await expect(runtime.getVersionExportContext(accepted.reviewSlug, versionId)).rejects.toThrow();
    await runtime.prisma.trustAssessment.update({
      where: { id: declaredAssessments[0]!.id },
      data: { conflictOfInterestStatus: "not-provided" },
    });

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
        "invalid-designation",
        submitterId,
        editorId,
        new Date().toISOString(),
      ),
    ).rejects.toThrow(/database guard rejected invalid state/i);
  }, 30_000);

  it("keeps preserved content durable after the ephemeral capture row is deleted", async () => {
    const capability = await runtime.createInspectionCapture(
      submitterId,
      inspectionReport("capture-pruned-review", "2"),
      fullExtraction("capture-pruned-review"),
      validationReport(),
      new Date(),
    );
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(submission.submissionId, editorId);
    const review = await runtime.prisma.review.findUniqueOrThrow({
      where: { slug: accepted.reviewSlug },
      include: { versions: true },
    });
    const versionId = review.versions[0]!.id;

    expect(
      await runtime.getPreservedFileContent(accepted.reviewSlug, versionId, "missing.md"),
    ).toBeNull();

    // The capture is an expiring capability, not the archive's copy: delete
    // the row entirely and preservation must be unaffected.
    await runtime.prisma.reviewVersion.update({
      where: { id: versionId },
      data: { inspectionCaptureId: null },
    });
    await runtime.prisma.submission.update({
      where: { id: submission.submissionId },
      data: { inspectionCaptureId: null },
    });
    await runtime.prisma.inspectionCapture.deleteMany({});

    const context = await runtime.getVersionExportContext(accepted.reviewSlug, versionId);
    expect(context?.manifest.preservedContentAvailable).toBe(true);
    const preserved = await runtime.getPreservedFileContent(
      accepted.reviewSlug,
      versionId,
      "README.md",
    );
    expect(preserved?.content).toBe(readmeContent);
  }, 30_000);

  it("rejects malformed persisted assessment and methodology JSON for scholarly exports", async () => {
    const capability = await runtime.createInspectionCapture(
      submitterId,
      inspectionReport("invalid-scholarly-export", "4"),
      fullExtraction("invalid-scholarly-export"),
      validationReport(),
      new Date(),
    );
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(submission.submissionId, editorId);
    const version = await runtime.prisma.reviewVersion.findFirstOrThrow({
      where: { review: { slug: accepted.reviewSlug } },
    });
    const claim = await runtime.prisma.claim.create({
      data: {
        reviewVersionId: version.id,
        localClaimId: "invalid-export-claim",
        text: "A bounded export-integrity claim.",
        normalizedText: "a bounded export-integrity claim",
      },
    });
    const citation = await runtime.prisma.citation.create({
      data: {
        reviewVersionId: version.id,
        localCitationId: "invalid-export-citation",
        title: "Export integrity source",
      },
    });
    const relation = await runtime.prisma.claimEvidenceRelation.create({
      data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
    });
    const assessment = await runtime.prisma.trustAssessment.create({
      data: {
        claimEvidenceRelationId: relation.id,
        protocolVersion: "trust-v2",
        assessorType: "human",
        entailment: JSON.stringify({ rating: "high", status: "assessed" }),
      },
    });
    const originalMetadata = JSON.parse(version.metadataJson) as Record<string, unknown>;
    const getContext = () => runtime.getVersionExportContext(accepted.reviewSlug, version.id);

    await runtime.prisma.trustAssessment.update({
      where: { id: assessment.id },
      data: { entailment: "{malformed" },
    });
    await expect(getContext()).rejects.toThrow("Stored TRUST criterion entailment is invalid.");

    await runtime.prisma.trustAssessment.update({
      where: { id: assessment.id },
      data: {
        entailment: JSON.stringify({ rating: "high", status: "assessed" }),
        limitationsJson: JSON.stringify({ silently: "dropped before this regression" }),
      },
    });
    await expect(getContext()).rejects.toThrow("Invalid persisted TRUST limitations");

    await runtime.prisma.trustAssessment.update({
      where: { id: assessment.id },
      data: { limitationsJson: "[]", evidenceJson: "[]" },
    });
    await expect(getContext()).rejects.toThrow("Invalid persisted TRUST evidence");

    await runtime.prisma.trustAssessment.update({
      where: { id: assessment.id },
      data: { evidenceJson: null },
    });
    await runtime.prisma.reviewVersion.update({
      where: { id: version.id },
      data: {
        metadataJson: JSON.stringify({
          ...originalMetadata,
          sourceAssessmentDocuments: { schemaVersion: "broken", documents: [] },
        }),
      },
    });
    await expect(getContext()).rejects.toThrow();

    const { sourceAssessmentDocuments: _legacyAbsent, ...legacyMetadata } = originalMetadata;
    await runtime.prisma.reviewVersion.update({
      where: { id: version.id },
      data: { metadataJson: JSON.stringify(legacyMetadata) },
    });
    const context = await getContext();
    expect(context?.scholarlyInput.sourceDocuments).toEqual([]);
    expect(() =>
      roCrate({
        version: context!.exportInput,
        files: context!.manifest.files,
        snapshotContentHash: context!.manifest.integrity.snapshotContentHash,
        capturePayloadHash: context!.manifest.integrity.capturePayloadHash,
        scholarly: {
          url: `${context!.exportInput.canonicalUrl.replace("/reviews/", "/api/reviews/")}/export/json`,
          document: scholarlyJsonDocument(context!.scholarlyInput),
        },
      }),
    ).not.toThrow();
  }, 30_000);

  it("fails closed for legacy rows without valid durable preserved content", async () => {
    const capability = await runtime.createInspectionCapture(
      submitterId,
      inspectionReport("legacy-review", "3"),
      fullExtraction("legacy-review"),
      validationReport(),
      new Date(),
    );
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(submission.submissionId, editorId);
    const review = await runtime.prisma.review.findUniqueOrThrow({
      where: { slug: accepted.reviewSlug },
      include: { versions: { include: { snapshot: true } } },
    });
    const versionId = review.versions[0]!.id;

    // Simulate a legacy row: no durable content column, no capture.
    await runtime.prisma.repositorySnapshot.update({
      where: { id: review.versions[0]!.snapshotId! },
      data: { preservedFilesJson: null },
    });
    await runtime.prisma.reviewVersion.update({
      where: { id: versionId },
      data: { inspectionCaptureId: null },
    });

    const context = await runtime.getVersionExportContext(accepted.reviewSlug, versionId);
    expect(context).toBeNull();
    expect(
      await runtime.getPreservedFileContent(accepted.reviewSlug, versionId, "README.md"),
    ).toBeNull();

    await runtime.prisma.repositorySnapshot.update({
      where: { id: review.versions[0]!.snapshotId! },
      data: { preservedFilesJson: "{malformed" },
    });
    expect(await runtime.getVersionExportContext(accepted.reviewSlug, versionId)).toBeNull();
    expect(
      await runtime.getPreservedFileContent(accepted.reviewSlug, versionId, "README.md"),
    ).toBeNull();
  }, 30_000);
});

function inspectionReport(name = "preserved-review", repoId = "1"): InspectionReport {
  return {
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: "lab",
      name,
      canonicalUrl: `https://github.com/lab/${name}`,
    },
    inspectedAt: nowIso,
    status: "succeeded",
    githubRepositoryId: repoId,
    defaultBranch: "main",
    latestCommitSha: commitA,
    topics: [],
    releases: [],
    tags: [],
    selectedSource: { kind: "default-branch", commitSha: commitA, treeSha: treeA, branch: "main" },
    tree: [
      { path: "README.md", size: Buffer.byteLength(readmeContent) },
      { path: "TRUST.md", size: Buffer.byteLength(trustDocument) },
      { path: "FAIR.md", size: Buffer.byteLength(fairDocument) },
    ],
    treeTruncated: false,
    files: {
      "README.md": {
        path: "README.md",
        size: readmeContent.length,
        content: readmeContent,
        truncated: false,
      },
      "TRUST.md": {
        path: "TRUST.md",
        size: Buffer.byteLength(trustDocument),
        content: trustDocument,
        truncated: false,
      },
      "FAIR.md": {
        path: "FAIR.md",
        size: Buffer.byteLength(fairDocument),
        content: fairDocument,
        truncated: false,
      },
    },
    warnings: [],
    limits: {
      maxFileBytes: 512_000,
      maxTotalBytes: 3_000_000,
      maxFileCount: 24,
      totalBytesFetched: readmeContent.length,
      filesFetched: 1,
    },
  };
}

function fullExtraction(name = "preserved-review"): FullExtraction {
  const provenance = {
    source: "repository-metadata" as const,
    commitSha: commitA,
    extractorVersion: "preservation-test",
    extractedAt: nowIso,
    confidence: 1,
    warnings: [],
  };
  return {
    metadata: {
      extractorVersion: "preservation-test",
      extractedAt: nowIso,
      commitSha: commitA,
      fields: {
        title: { value: `Preserved Review ${name}`, provenance },
        repositoryUrl: { value: `https://github.com/lab/${name}`, provenance },
        commitSha: { value: commitA, provenance },
      },
      warnings: [],
    },
    manifestPresent: false,
    knowledge: { claims: [], citations: [], relations: [], trust: [], warnings: [] },
    nodeExtraction: createEmptyNodeExtractionReport({
      commitSha: commitA,
      extractorVersion: "preservation-test",
    }),
    compatibility: compatibilityReport(),
    sourceAssessmentDocuments: {
      schemaVersion: "1.0.0",
      documents: [
        {
          kind: "trust",
          path: "TRUST.md",
          status: "preserved",
          size: Buffer.byteLength(trustDocument),
          contentHash: sha256(trustDocument),
          provenance: {
            source: "repository-file",
            commitSha: commitA,
            extractorVersion: "preservation-test",
          },
        },
        {
          kind: "fair",
          path: "FAIR.md",
          status: "preserved",
          size: Buffer.byteLength(fairDocument),
          contentHash: sha256(fairDocument),
          provenance: {
            source: "repository-file",
            commitSha: commitA,
            extractorVersion: "preservation-test",
          },
        },
      ],
    },
  };
}

function compatibilityReport(): Extract<CompatibilityReport, { schemaVersion: "1.1.0" }> {
  const absent = { detected: false, evidence: [] };
  const notDeclared = {
    status: "not-declared" as const,
    loadedCount: 0 as const,
    skippedCount: 0 as const,
    sources: [],
  };
  return {
    schemaVersion: "1.1.0",
    templateForkDetected: absent,
    templateFilesDetected: absent,
    mystProjectDetected: absent,
    bibliographyDetected: absent,
    reviewContentDetected: { detected: true, evidence: ["preservation fixture"] },
    provenanceDetected: absent,
    trustDataDetected: absent,
    releaseDetected: absent,
    doiDetected: absent,
    overallCompatibility: "compatible",
    levelRationale: ["Preservation fixture is structurally compatible."],
    blockingErrors: [],
    warnings: [],
    recommendations: [],
    artifactOutcomes: {
      claims: notDeclared,
      citations: notDeclared,
      relations: notDeclared,
      trust: notDeclared,
      nodes: notDeclared,
      edges: notDeclared,
    },
  };
}

function validationReport(): SubmissionValidationReport {
  return {
    schemaVersion: "1.0.0",
    hardErrors: [],
    warnings: [],
    releaseValidation: { releaseDetected: false, details: [] },
    publicationConsistency: {
      schemaVersion: "1.0.0",
      status: "not-applicable",
      selectedSourceKind: "default-branch",
      selectedCommitSha: commitA,
      selectedTreeSha: treeA,
      checks: [],
      errors: [],
      warnings: [],
      overridableCheckIds: [],
      requiresEditorOverride: false,
    },
    metadataCompleteness: { requiredMissing: [], recommendedMissing: [], score: 1 },
    compatibilityLevel: "compatible",
    evidenceDataAvailable: false,
    trustDataAvailable: false,
    validatedAt: nowIso,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
