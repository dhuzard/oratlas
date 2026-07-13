import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  type CompatibilityReport,
  type FormalReviewReportBody,
  type InspectionReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { type FullExtraction } from "@oratlas/extractor";
import { type PrismaClient } from "@oratlas/db";
import { type createInspectionCapture } from "./inspection-captures";
import { type createSubmission } from "./submissions";
import type * as Lifecycle from "./editorial-lifecycle";
import { type getDocmapForVersion } from "./editorial-docmap";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-lifecycle-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;
const commitA = "a".repeat(40);
const treeA = "b".repeat(40);
const nowIso = "2026-07-12T08:00:00.000Z";

type Runtime = {
  prisma: PrismaClient;
  createInspectionCapture: typeof createInspectionCapture;
  createSubmission: typeof createSubmission;
  lifecycle: typeof Lifecycle;
  getDocmapForVersion: typeof getDocmapForVersion;
};

let runtime: Runtime;
let submitter: { id: string; role: string };
let editor: { id: string; role: string };
let reviewer: { id: string; role: string };
let editorSubmitter: { id: string; role: string };

const reportBody: FormalReviewReportBody = {
  schemaVersion: "1.0.0",
  summary:
    "The methods are sound and the evidence mapping is thorough, but the synthesis overstates certainty in section 3.",
  strengths: ["Clear replication of the primary analyses."],
  weaknesses: ["Certainty language in section 3 is not supported by the cited effect sizes."],
  questions: ["Were the exclusion criteria pre-registered?"],
};

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(
    resolve(process.cwd(), "packages/db/node_modules/.bin/prisma"),
    ["db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate"],
    { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
  );
  const { prisma } = await import("./db");
  const captures = await import("./inspection-captures");
  const submissions = await import("./submissions");
  const lifecycle = await import("./editorial-lifecycle");
  const docmapLib = await import("./editorial-docmap");
  runtime = {
    prisma,
    createInspectionCapture: captures.createInspectionCapture,
    createSubmission: submissions.createSubmission,
    lifecycle,
    getDocmapForVersion: docmapLib.getDocmapForVersion,
  };
  const mk = async (login: string, role: string) => {
    const row = await prisma.user.create({
      data: { githubUserId: `lc-${login}`, githubLogin: `lc-${login}`, role },
    });
    return { id: row.id, role };
  };
  submitter = await mk("submitter", "USER");
  editor = await mk("editor", "EDITOR");
  reviewer = await mk("reviewer", "USER");
  editorSubmitter = await mk("editor-submitter", "EDITOR");
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

async function newSubmission(
  submitterId: string,
  name: string,
  repoId: string,
  previousSubmissionId?: string,
) {
  const capability = await runtime.createInspectionCapture(
    submitterId,
    inspectionReport(name, repoId),
    fullExtraction(name),
    validationReport(),
    new Date(),
  );
  return runtime.createSubmission({
    inspectionToken: capability.token,
    submitterId,
    previousSubmissionId,
  });
}

describe.sequential("formal editorial-review lifecycle", () => {
  it("traverses review rounds with an immutable, attributable public process history", async () => {
    const { lifecycle } = runtime;
    const first = await newSubmission(submitter.id, "lifecycle-review", "901");

    // Conflicts of interest: an editor never handles their own submission,
    // and a declared conflict records the assignment as recused.
    const own = await newSubmission(editorSubmitter.id, "own-review", "902");
    await expect(
      lifecycle.assignEditor(editor, own.submissionId, editorSubmitter.id, {
        declared: false,
        statement: "",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const conflicted = await lifecycle.assignEditor(editor, own.submissionId, editor.id, {
      declared: true,
      statement: "I collaborated with this submitter last year.",
    });
    expect(conflicted.status).toBe("recused");
    await expect(lifecycle.openReviewRound(editor, own.submissionId)).rejects.toMatchObject({
      code: "forbidden",
    });

    // Round 1 on the main submission.
    const assigned = await lifecycle.assignEditor(editor, first.submissionId, editor.id, {
      declared: false,
      statement: "",
    });
    expect(assigned.status).toBe("active");
    const round1 = await lifecycle.openReviewRound(editor, first.submissionId);
    expect(round1.roundNumber).toBe(1);
    await expect(lifecycle.openReviewRound(editor, first.submissionId)).rejects.toMatchObject({
      code: "conflict",
    });

    // Reviewer identity: ORCID snapshot is explicit about verification.
    await lifecycle.setUserOrcid(reviewer, "0000-0002-1825-0097");
    await expect(
      lifecycle.submitReviewReport(submitter, round1.roundId, "reject", reportBody),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      lifecycle.submitReviewReport(editor, round1.roundId, "accept", reportBody),
    ).rejects.toMatchObject({ code: "conflict" });
    const report = await lifecycle.submitReviewReport(
      reviewer,
      round1.roundId,
      "major-revision",
      reportBody,
      "No competing interests.",
    );
    expect(report.bodyHash).toBe(sha256(canonicalJson(reportBody)));
    await expect(
      lifecycle.submitReviewReport(reviewer, round1.roundId, "accept", reportBody),
    ).rejects.toMatchObject({ code: "conflict" });

    // Author response, then a request-changes decision letter closes round 1.
    await expect(
      lifecycle.submitAuthorResponse(reviewer, round1.roundId, {
        schemaVersion: "1.0.0",
        response: "I am not the submitter and must be refused.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await lifecycle.submitAuthorResponse(submitter, round1.roundId, {
      schemaVersion: "1.0.0",
      response: "We will soften the certainty language and add the requested effect sizes.",
    });
    const decision1 = await lifecycle.issueDecision(editor, round1.roundId, "request-changes", {
      schemaVersion: "1.0.0",
      letter: "Please address the certainty language before we continue to round two.",
    });
    expect(decision1.decision).toBe("request-changes");
    await expect(
      lifecycle.issueDecision(editor, round1.roundId, "reject", {
        schemaVersion: "1.0.0",
        letter: "A second decision on the same round must be refused.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      lifecycle.submitReviewReport(reviewer, round1.roundId, "accept", reportBody),
    ).rejects.toMatchObject({ code: "conflict" });

    // Resubmission: lineage recorded, previous superseded, editor carried over.
    const second = await newSubmission(submitter.id, "lifecycle-review", "901", first.submissionId);
    const firstRow = await runtime.prisma.submission.findUniqueOrThrow({
      where: { id: first.submissionId },
    });
    expect(firstRow.status).toBe("superseded");
    const carried = await runtime.prisma.editorAssignment.findUniqueOrThrow({
      where: {
        submissionId_editorId: { submissionId: second.submissionId, editorId: editor.id },
      },
    });
    expect(carried.status).toBe("active");

    // Round 2 ends in acceptance and atomic publication.
    const round2 = await lifecycle.openReviewRound(editor, second.submissionId);
    expect(round2.roundNumber).toBe(1);
    await lifecycle.submitReviewReport(reviewer, round2.roundId, "accept", reportBody);
    const decision2 = await lifecycle.issueDecision(editor, round2.roundId, "accept", {
      schemaVersion: "1.0.0",
      letter: "The revision addresses every concern from round one. Accepted.",
    });
    expect(decision2.reviewSlug).toBeDefined();

    // Public process history spans the revision lineage, oldest first, with
    // verifiable hashes and attributable actors.
    const history = await lifecycle.getProcessHistory(second.submissionId);
    expect(history).toHaveLength(2);
    expect(history[0]!.status).toBe("superseded");
    expect(history[1]!.status).toBe("accepted");
    const historicReport = history[0]!.rounds[0]!.reports[0]!;
    expect(historicReport.reviewerLogin).toBe("lc-reviewer");
    expect(historicReport.reviewerOrcid).toBe("0000-0002-1825-0097");
    expect(historicReport.orcidVerified).toBe(false);
    expect(historicReport.bodyHash).toBe(sha256(canonicalJson(historicReport.body)));
    expect(history[0]!.rounds[0]!.decision?.decision).toBe("request-changes");
    expect(history[1]!.rounds[0]!.decision?.decision).toBe("accept");

    // DocMaps export of the published version covers the full chain.
    const review = await runtime.prisma.review.findUniqueOrThrow({
      where: { slug: decision2.reviewSlug! },
      include: { versions: true },
    });
    const map = await runtime.getDocmapForVersion(decision2.reviewSlug!, review.versions[0]!.id);
    expect(map).not.toBeNull();
    const steps = map!["steps"] as Record<string, unknown>;
    expect(Object.keys(steps)).toHaveLength(4); // submission, 2 rounds, publication
    const serialized = JSON.stringify(map);
    expect(serialized).toContain("lc-reviewer");
    expect(serialized).toContain("decision:request-changes");
    expect(serialized).toContain('"status":"published"');
    // Unverified ORCIDs never become identifiers.
    expect(serialized).not.toContain("orcid.org");

    // Notifications reached the editor and are user-scoped.
    const editorNotifications = await lifecycle.listNotifications(editor.id);
    expect(editorNotifications.some((entry) => entry.kind === "report-submitted")).toBe(true);
    expect(editorNotifications.some((entry) => entry.kind === "submission-resubmitted")).toBe(true);
    const target = editorNotifications.find((entry) => entry.kind === "report-submitted")!;
    await expect(lifecycle.markNotificationRead(reviewer.id, target.id)).rejects.toMatchObject({
      code: "not-found",
    });
    await lifecycle.markNotificationRead(editor.id, target.id);
    const unread = await lifecycle.listNotifications(editor.id, true);
    expect(unread.some((entry) => entry.id === target.id)).toBe(false);
  }, 60_000);

  it("refuses resubmission lineage that crosses submitters or undecided states", async () => {
    const { lifecycle } = runtime;
    const base = await newSubmission(submitter.id, "lineage-guard-review", "903");
    // Not changes-requested yet.
    await expect(
      newSubmission(submitter.id, "lineage-guard-review", "903", base.submissionId),
    ).rejects.toMatchObject({ code: "conflict" });
    await lifecycle.assignEditor(editor, base.submissionId, editor.id, {
      declared: false,
      statement: "",
    });
    const round = await lifecycle.openReviewRound(editor, base.submissionId);
    await lifecycle.issueDecision(editor, round.roundId, "request-changes", {
      schemaVersion: "1.0.0",
      letter: "Please revise the missing methods sections before resubmission.",
    });
    // Another submitter cannot claim the lineage.
    await expect(
      newSubmission(reviewer.id, "lineage-guard-review", "903", base.submissionId),
    ).rejects.toMatchObject({ code: "conflict" });
  }, 30_000);
});

function inspectionReport(name: string, repoId: string): InspectionReport {
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

function fullExtraction(name: string): FullExtraction {
  const provenance = {
    source: "repository-metadata" as const,
    commitSha: commitA,
    extractorVersion: "lifecycle-test",
    extractedAt: nowIso,
    confidence: 1,
    warnings: [],
  };
  return {
    metadata: {
      extractorVersion: "lifecycle-test",
      extractedAt: nowIso,
      commitSha: commitA,
      fields: {
        title: { value: `Lifecycle Review ${name}`, provenance },
        repositoryUrl: { value: `https://github.com/lab/${name}`, provenance },
        commitSha: { value: commitA, provenance },
      },
      warnings: [],
    },
    manifestPresent: false,
    knowledge: { claims: [], citations: [], relations: [], trust: [], warnings: [] },
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
    reviewContentDetected: { detected: true, evidence: ["lifecycle fixture"] },
    provenanceDetected: absent,
    trustDataDetected: absent,
    releaseDetected: absent,
    doiDetected: absent,
    overallCompatibility: "compatible",
    levelRationale: ["Lifecycle fixture is structurally compatible."],
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
