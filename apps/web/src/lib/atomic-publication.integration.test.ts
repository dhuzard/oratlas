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
import { type PrismaClient } from "@oratlas/db";
import { type createInspectionCapture } from "./inspection-captures";
import { type acceptSubmission, type createSubmission, type decideSubmission } from "./submissions";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-atomic-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;
const commitA = "a".repeat(40);
const treeA = "b".repeat(40);
const nowIso = "2026-07-12T08:00:00.000Z";

type Runtime = {
  prisma: PrismaClient;
  createInspectionCapture: typeof createInspectionCapture;
  createSubmission: typeof createSubmission;
  acceptSubmission: typeof acceptSubmission;
  decideSubmission: typeof decideSubmission;
};

let runtime: Runtime;
let submitterId: string;
let otherUserId: string;
let editorId: string;
let sequence = 0;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(
    resolve(process.cwd(), "packages/db/node_modules/.bin/prisma"),
    ["db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );
  const { prisma } = await import("./db");
  const captures = await import("./inspection-captures");
  const submissions = await import("./submissions");
  runtime = {
    prisma,
    createInspectionCapture: captures.createInspectionCapture,
    createSubmission: submissions.createSubmission,
    acceptSubmission: submissions.acceptSubmission,
    decideSubmission: submissions.decideSubmission,
  };
  const submitter = await prisma.user.create({
    data: { githubUserId: "atomic-submitter", githubLogin: "atomic-submitter", role: "USER" },
  });
  const other = await prisma.user.create({
    data: { githubUserId: "atomic-other", githubLogin: "atomic-other", role: "USER" },
  });
  const editor = await prisma.user.create({
    data: { githubUserId: "atomic-editor", githubLogin: "atomic-editor", role: "EDITOR" },
  });
  submitterId = submitter.id;
  otherUserId = other.id;
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

describe.sequential("atomic publication integration", () => {
  it("rejects a capability owned by another user", async () => {
    const capability = await capture({ githubRepositoryId: nextRepoId() });
    await expect(
      runtime.createSubmission({ inspectionToken: capability.token, submitterId: otherUserId }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("fails closed on expiry and canonical payload tampering", async () => {
    const expired = await capture({
      githubRepositoryId: nextRepoId(),
      capturedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    await expect(
      runtime.createSubmission({ inspectionToken: expired.token, submitterId }),
    ).rejects.toThrow("expired");

    const tampered = await capture({ githubRepositoryId: nextRepoId() });
    await runtime.prisma.inspectionCapture.update({
      where: { tokenHash: sha256(tampered.token) },
      data: { payloadJson: `${tampered.payloadJson} ` },
    });
    await expect(
      runtime.createSubmission({ inspectionToken: tampered.token, submitterId }),
    ).rejects.toThrow("integrity");
  });

  it("consumes a capability once and never re-reads changed upstream state", async () => {
    const capability = await capture({ githubRepositoryId: nextRepoId() });
    const first = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    expect(first.status).toBe("pending-editorial-review");
    await expect(
      runtime.createSubmission({ inspectionToken: capability.token, submitterId }),
    ).rejects.toMatchObject({ code: "conflict" });
    const stored = await runtime.prisma.submission.findUnique({
      where: { id: first.submissionId },
      include: { snapshot: true },
    });
    expect(stored?.snapshot?.commitSha).toBe(commitA);
    expect(stored?.snapshot?.sourceTreeSha).toBe(treeA);
  });

  it("keeps reinspection captures append-only while deduplicating the source snapshot", async () => {
    const repositoryId = nextRepoId();
    const first = await capture({ githubRepositoryId: repositoryId });
    const second = await capture({ githubRepositoryId: repositoryId });
    const [a, b] = await Promise.all([
      runtime.createSubmission({ inspectionToken: first.token, submitterId }),
      runtime.createSubmission({ inspectionToken: second.token, submitterId }),
    ]);
    const submissions = await runtime.prisma.submission.findMany({
      where: { id: { in: [a.submissionId, b.submissionId] } },
    });
    expect(new Set(submissions.map((row) => row.inspectionCaptureId)).size).toBe(2);
    expect(new Set(submissions.map((row) => row.snapshotId)).size).toBe(1);
    expect(
      await runtime.prisma.repository.count({ where: { githubRepositoryId: repositoryId } }),
    ).toBe(1);
  });

  it("accepts default then release selections of the same commit as distinct versions", async () => {
    await assertSameCommitSelectionOrder(["default-branch", "release"]);
  });

  it("accepts release then default selections of the same commit as distinct versions", async () => {
    await assertSameCommitSelectionOrder(["release", "default-branch"]);
  });

  it("publishes concurrent distinct selections into one review", async () => {
    const githubRepositoryId = nextRepoId();
    const [defaultCapture, releaseCapture] = await Promise.all([
      capture({ githubRepositoryId, sourceKind: "default-branch" }),
      capture({ githubRepositoryId, sourceKind: "release", releaseTag: "v1" }),
    ]);
    const [defaultSubmission, releaseSubmission] = await Promise.all([
      runtime.createSubmission({ inspectionToken: defaultCapture.token, submitterId }),
      runtime.createSubmission({ inspectionToken: releaseCapture.token, submitterId }),
    ]);
    const outcomes = await Promise.all([
      runtime.acceptSubmission(defaultSubmission.submissionId, editorId),
      runtime.acceptSubmission(releaseSubmission.submissionId, editorId),
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.reviewSlug)).size).toBe(1);
    const review = await runtime.prisma.review.findUniqueOrThrow({
      where: { slug: outcomes[0]!.reviewSlug },
      include: { versions: true },
    });
    expect(review.versions).toHaveLength(2);
    expect(new Set(review.versions.map((version) => version.sourceKind))).toEqual(
      new Set(["default-branch", "release"]),
    );
  });

  it("tracks a rename by immutable GitHub repository id", async () => {
    const repositoryId = nextRepoId();
    const first = await capture({
      githubRepositoryId: repositoryId,
      owner: "old-owner",
      name: "review",
    });
    await runtime.createSubmission({ inspectionToken: first.token, submitterId });
    const second = await capture({
      githubRepositoryId: repositoryId,
      owner: "new-owner",
      name: "renamed",
    });
    await runtime.createSubmission({ inspectionToken: second.token, submitterId });
    const rows = await runtime.prisma.repository.findMany({
      where: { githubRepositoryId: repositoryId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      owner: "new-owner",
      name: "renamed",
      canonicalUrl: "https://github.com/new-owner/renamed",
    });
  });

  it("makes repeated and concurrent acceptance idempotent", async () => {
    const capability = await capture({ githubRepositoryId: nextRepoId() });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const results = await Promise.all([
      runtime.acceptSubmission(submission.submissionId, editorId),
      runtime.acceptSubmission(submission.submissionId, editorId),
    ]);
    expect(results.map((result) => result.reviewSlug)).toEqual([
      results[0]!.reviewSlug,
      results[0]!.reviewSlug,
    ]);
    expect(results.some((result) => result.idempotent)).toBe(true);
    expect(
      await runtime.prisma.reviewVersion.count({
        where: { sourceSubmissionId: submission.submissionId },
      }),
    ).toBe(1);
    expect(
      await runtime.prisma.auditEvent.count({
        where: { idempotencyKey: `submission.accepted:${submission.submissionId}` },
      }),
    ).toBe(1);
  });

  it("allows only one terminal result in an accept-versus-reject race", async () => {
    const capability = await capture({ githubRepositoryId: nextRepoId() });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const outcomes = await Promise.allSettled([
      runtime.acceptSubmission(submission.submissionId, editorId),
      runtime.decideSubmission(submission.submissionId, editorId, "reject"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const stored = await runtime.prisma.submission.findUnique({
      where: { id: submission.submissionId },
    });
    expect(["accepted", "rejected"]).toContain(stored?.status);
    if (stored?.status === "accepted") expect(stored.resultingReviewVersionId).toBeTruthy();
    if (stored?.status === "rejected") expect(stored.resultingReviewVersionId).toBeNull();
  });

  it("rolls back the status, version and audits when materialization fails", async () => {
    const duplicateClaim = {
      id: "duplicate",
      text: "Duplicate claim",
      claimType: "empirical" as const,
    };
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      knowledge: {
        claims: [duplicateClaim, duplicateClaim],
        citations: [],
        relations: [],
        trust: [],
        warnings: [],
      },
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    await expect(runtime.acceptSubmission(submission.submissionId, editorId)).rejects.toBeTruthy();
    const stored = await runtime.prisma.submission.findUnique({
      where: { id: submission.submissionId },
    });
    expect(stored?.status).toBe("pending-editorial-review");
    expect(stored?.resultingReviewVersionId).toBeNull();
    expect(
      await runtime.prisma.reviewVersion.count({
        where: { sourceSubmissionId: submission.submissionId },
      }),
    ).toBe(0);
    expect(
      await runtime.prisma.auditEvent.count({
        where: { idempotencyKey: `submission.accepted:${submission.submissionId}` },
      }),
    ).toBe(0);
  });

  it("requires and records a rationale for every failed consistency check", async () => {
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      sourceKind: "tag",
      releaseTag: "v1",
      metadataCommitSha: "c".repeat(40),
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    expect(submission.status).toBe("automated-checks-failed");
    await expect(runtime.acceptSubmission(submission.submissionId, editorId)).rejects.toThrow(
      "overrides",
    );
    const result = await runtime.acceptSubmission(submission.submissionId, editorId, undefined, [
      {
        checkId: "metadata-commit",
        rationale: "The editor verified the intended historical commit independently.",
      },
    ]);
    expect(result.idempotent).toBe(false);
    const override = await runtime.prisma.editorialOverride.findUnique({
      where: {
        submissionId_checkId: { submissionId: submission.submissionId, checkId: "metadata-commit" },
      },
    });
    expect(override).toMatchObject({ editorId, checkId: "metadata-commit" });
  });
});

async function capture(options: {
  githubRepositoryId: string;
  owner?: string;
  name?: string;
  capturedAt?: Date;
  sourceKind?: "default-branch" | "tag" | "release";
  releaseTag?: string;
  metadataCommitSha?: string;
  knowledge?: FullExtraction["knowledge"];
}) {
  const owner = options.owner ?? "lab";
  const name = options.name ?? `review-${sequence}`;
  const sourceKind = options.sourceKind ?? "default-branch";
  const report = inspectionReport({
    owner,
    name,
    githubRepositoryId: options.githubRepositoryId,
    sourceKind,
    releaseTag: options.releaseTag,
  });
  const extraction = fullExtraction(
    report,
    options.metadataCommitSha ?? commitA,
    options.releaseTag,
    options.knowledge,
  );
  const baseValidation = validationReport(report);
  const capability = await runtime.createInspectionCapture(
    submitterId,
    report,
    extraction,
    baseValidation,
    options.capturedAt ?? new Date(),
  );
  const row = await runtime.prisma.inspectionCapture.findUniqueOrThrow({
    where: { tokenHash: sha256(capability.token) },
  });
  return { ...capability, payloadJson: row.payloadJson };
}

function inspectionReport(options: {
  owner: string;
  name: string;
  githubRepositoryId: string;
  sourceKind: "default-branch" | "tag" | "release";
  releaseTag?: string;
}): InspectionReport {
  const releaseTag =
    options.sourceKind === "default-branch" ? undefined : (options.releaseTag ?? "v1");
  return {
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: options.owner,
      name: options.name,
      canonicalUrl: `https://github.com/${options.owner}/${options.name}`,
    },
    inspectedAt: nowIso,
    status: "succeeded",
    githubRepositoryId: options.githubRepositoryId,
    defaultBranch: "main",
    latestCommitSha: commitA,
    topics: [],
    releases: [],
    tags: releaseTag ? [{ name: releaseTag, commitSha: commitA }] : [],
    selectedSource: {
      kind: options.sourceKind,
      commitSha: commitA,
      treeSha: treeA,
      ...(options.sourceKind === "default-branch" ? { branch: "main" } : { releaseTag }),
    },
    tree: [],
    treeTruncated: false,
    files: {},
    warnings: [],
    limits: {
      maxFileBytes: 512_000,
      maxTotalBytes: 3_000_000,
      maxFileCount: 24,
      totalBytesFetched: 0,
      filesFetched: 0,
    },
  };
}

function fullExtraction(
  report: InspectionReport,
  metadataCommitSha: string,
  releaseTag: string | undefined,
  knowledge: FullExtraction["knowledge"] = {
    claims: [],
    citations: [],
    relations: [],
    trust: [],
    warnings: [],
  },
): FullExtraction {
  const provenance = {
    source: "repository-metadata" as const,
    commitSha: report.selectedSource!.commitSha,
    extractorVersion: "integration-test",
    extractedAt: nowIso,
    confidence: 1,
    warnings: [],
  };
  return {
    metadata: {
      extractorVersion: "integration-test",
      extractedAt: nowIso,
      commitSha: report.selectedSource!.commitSha,
      fields: {
        title: { value: `Review ${report.githubRepositoryId}`, provenance },
        repositoryUrl: { value: report.repo.canonicalUrl, provenance },
        commitSha: { value: metadataCommitSha, provenance },
        ...(releaseTag ? { releaseTag: { value: releaseTag, provenance } } : {}),
      },
      warnings: [],
    },
    manifestPresent: false,
    knowledge,
    nodeExtraction: createEmptyNodeExtractionReport({
      commitSha: report.selectedSource!.commitSha,
      extractorVersion: "integration-test",
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
    reviewContentDetected: { detected: true, evidence: ["integration fixture"] },
    provenanceDetected: absent,
    trustDataDetected: absent,
    releaseDetected: absent,
    doiDetected: absent,
    overallCompatibility: "compatible",
    levelRationale: ["Integration fixture is structurally compatible."],
    blockingErrors: [],
    warnings: [],
    recommendations: [],
  };
}

function validationReport(report: InspectionReport): SubmissionValidationReport {
  return {
    schemaVersion: "1.0.0",
    hardErrors: [],
    warnings: [],
    releaseValidation: { releaseDetected: false, details: [] },
    publicationConsistency: {
      schemaVersion: "1.0.0",
      status: "not-applicable",
      selectedSourceKind: report.selectedSource!.kind,
      selectedCommitSha: report.selectedSource!.commitSha,
      selectedTreeSha: report.selectedSource!.treeSha,
      selectedReleaseTag: report.selectedSource!.releaseTag,
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

function nextRepoId(): string {
  sequence += 1;
  return String(90_000 + sequence);
}

async function assertSameCommitSelectionOrder(
  order: Array<"default-branch" | "release">,
): Promise<void> {
  const githubRepositoryId = nextRepoId();
  const acceptedVersionIds: string[] = [];
  for (const sourceKind of order) {
    const capability = await capture({
      githubRepositoryId,
      sourceKind,
      releaseTag: sourceKind === "release" ? "v1" : undefined,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(submission.submissionId, editorId);
    const version = await runtime.prisma.reviewVersion.findFirstOrThrow({
      where: { review: { slug: accepted.reviewSlug }, sourceSubmissionId: submission.submissionId },
    });
    acceptedVersionIds.push(version.id);
  }
  const versions = await runtime.prisma.reviewVersion.findMany({
    where: { id: { in: acceptedVersionIds } },
    include: { snapshot: true },
  });
  expect(versions).toHaveLength(2);
  expect(new Set(versions.map((version) => version.snapshotId)).size).toBe(1);
  expect(new Set(versions.map((version) => version.sourceKind))).toEqual(
    new Set(["default-branch", "release"]),
  );
  expect(versions.every((version) => version.inspectionCaptureId)).toBe(true);
  expect(versions.every((version) => version.snapshot.sourceKind === null)).toBe(true);
  expect(versions.every((version) => version.snapshot.releaseTag === null)).toBe(true);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
