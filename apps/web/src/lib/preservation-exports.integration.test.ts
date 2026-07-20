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
import { bibtex, jats, provJsonLd, roCrate } from "@oratlas/exports";
import { type PrismaClient } from "@oratlas/db";
import { type createInspectionCapture } from "./inspection-captures";
import { type acceptSubmission, type createSubmission } from "./submissions";
import { type getPreservedFileContent, type getVersionExportContext } from "./preservation";
import { type createChallenge, type listChallengeSubjectOptions } from "./challenges";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-preservation-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;
const commitA = "a".repeat(40);
const treeA = "b".repeat(40);
const nowIso = "2026-07-12T08:00:00.000Z";
const readmeContent = "# Preserved Review\n\nBody with <markup> & special chars.\n";

type Runtime = {
  prisma: PrismaClient;
  createInspectionCapture: typeof createInspectionCapture;
  createSubmission: typeof createSubmission;
  acceptSubmission: typeof acceptSubmission;
  getVersionExportContext: typeof getVersionExportContext;
  getPreservedFileContent: typeof getPreservedFileContent;
  createChallenge: typeof createChallenge;
  listChallengeSubjectOptions: typeof listChallengeSubjectOptions;
};

let runtime: Runtime;
let submitterId: string;
let editorId: string;

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
  runtime = {
    prisma,
    createInspectionCapture: captures.createInspectionCapture,
    createSubmission: submissions.createSubmission,
    acceptSubmission: submissions.acceptSubmission,
    getVersionExportContext: preservation.getVersionExportContext,
    getPreservedFileContent: preservation.getPreservedFileContent,
    createChallenge: challenges.createChallenge,
    listChallengeSubjectOptions: challenges.listChallengeSubjectOptions,
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
    const challengeSentinel = "OPEN-CHALLENGE-WITHOUT-EXPORT-CONTRACT-MUST-NOT-ENTER-EXPORTS";
    await runtime.prisma.claim.create({
      data: {
        reviewVersionId: versionId,
        localClaimId: "e03-export-subject",
        text: "A bounded subject used to verify challenge export isolation.",
        normalizedText: "a bounded subject used to verify challenge export isolation",
      },
    });
    const challengeSubject = (await runtime.listChallengeSubjectOptions(versionId)).find(
      ({ subject }) => subject.type === "claim",
    );
    expect(challengeSubject).toBeDefined();
    await runtime.createChallenge(
      accepted.reviewSlug,
      {
        id: submitterId,
        githubLogin: "pres-submitter",
        displayName: null,
        avatarUrl: null,
        profileUrl: null,
        role: "USER",
      },
      {
        reviewVersionId: versionId,
        subject: challengeSubject!.subject,
        canonicalSubjectHash: challengeSubject!.canonicalSubjectHash,
        grounds: "methodology",
        body: challengeSentinel,
      },
    );

    // Simulate upstream deletion: nothing in the export path may consult the
    // network, so exports must be derivable purely from stored rows.
    const context = await runtime.getVersionExportContext(accepted.reviewSlug, versionId);
    expect(context).not.toBeNull();
    const { exportInput, provInput, manifest } = context!;

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

    const bib = bibtex(exportInput);
    expect(bib).toContain(`commit ${commitA}`);
    const jatsXml = jats(exportInput);
    expect(jatsXml).toContain("<journal-title>Open Review Atlas</journal-title>");
    const crate = roCrate({
      version: exportInput,
      files: manifest.files,
      snapshotContentHash: manifest.integrity.snapshotContentHash,
      capturePayloadHash: manifest.integrity.capturePayloadHash,
    });
    expect(JSON.stringify(crate)).toContain(`swh:1:rev:${commitA}`);
    const prov = provJsonLd(provInput);
    const serializedProv = JSON.stringify(prov);
    expect(serializedProv).toContain(capability.payloadHash);
    expect(serializedProv).toContain("pres-editor");
    const exportsByFormat = {
      bibtex: bib,
      jats: jatsXml,
      roCrate: JSON.stringify(crate),
      prov: serializedProv,
      manifest: JSON.stringify(manifest),
    };
    for (const sentinel of [discussionSentinel, challengeSentinel]) {
      expect(
        Object.fromEntries(
          Object.entries(exportsByFormat).map(([format, value]) => [
            format,
            value.includes(sentinel),
          ]),
        ),
      ).toEqual({ bibtex: false, jats: false, roCrate: false, prov: false, manifest: false });
    }
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
    tree: [{ path: "README.md", size: readmeContent.length }],
    treeTruncated: false,
    files: {
      "README.md": {
        path: "README.md",
        size: readmeContent.length,
        content: readmeContent,
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
  };
}

function compatibilityReport(): CompatibilityReport {
  const absent = { detected: false, evidence: [] };
  return {
    schemaVersion: "1.0.0",
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
