import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CompatibilityReport,
  type InspectionReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { type FullExtraction } from "@oratlas/extractor";
import { type PrismaClient } from "@oratlas/db";
import { type createInspectionCapture } from "./inspection-captures";
import { type acceptSubmission, type createSubmission } from "./submissions";
import type * as Monitoring from "./claim-monitoring";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-monitoring-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file:${databasePath}`;
const commitA = "a".repeat(40);
const treeA = "b".repeat(40);
const nowIso = "2026-07-12T08:00:00.000Z";
const RETRACTED_DOI = "10.1234/retracted-work";
const CLEAN_DOI = "10.1234/solid-work";

type Runtime = {
  prisma: PrismaClient;
  createInspectionCapture: typeof createInspectionCapture;
  createSubmission: typeof createSubmission;
  acceptSubmission: typeof acceptSubmission;
  monitoring: typeof Monitoring;
};

let runtime: Runtime;
let submitter: { id: string; role: string };
let editor: { id: string; role: string };
let user: { id: string; role: string };
let reviewSlug: string;
let versionId: string;

const knowledge: FullExtraction["knowledge"] = {
  claims: [
    { id: "claim-hit", text: "Automated sorters match manual curation on dense probes." },
    { id: "claim-miss", text: "Drift correction is required for chronic recordings." },
  ],
  citations: [
    { id: "cit-retracted", doi: RETRACTED_DOI, title: "Retracted sorter benchmark" },
    { id: "cit-clean", doi: CLEAN_DOI, title: "Solid drift study" },
  ],
  relations: [
    {
      claimId: "claim-hit",
      citationId: "cit-retracted",
      relationType: "supports",
      sourceLocation: "content/review.md#L42",
    },
    { claimId: "claim-miss", citationId: "cit-clean", relationType: "supports" },
  ],
  trust: [],
  warnings: [],
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
  const monitoring = await import("./claim-monitoring");
  runtime = {
    prisma,
    createInspectionCapture: captures.createInspectionCapture,
    createSubmission: submissions.createSubmission,
    acceptSubmission: submissions.acceptSubmission,
    monitoring,
  };
  const mk = async (login: string, role: string) => {
    const row = await prisma.user.create({
      data: { githubUserId: `mon-${login}`, githubLogin: `mon-${login}`, role },
    });
    return { id: row.id, role };
  };
  submitter = await mk("submitter", "USER");
  editor = await mk("editor", "EDITOR");
  user = await mk("user", "USER");

  const capability = await runtime.createInspectionCapture(
    submitter.id,
    inspectionReport(),
    fullExtraction(),
    validationReport(),
    new Date(),
  );
  const submission = await runtime.createSubmission({
    inspectionToken: capability.token,
    submitterId: submitter.id,
  });
  const accepted = await runtime.acceptSubmission(submission.submissionId, editor.id);
  reviewSlug = accepted.reviewSlug;
  const review = await prisma.review.findUniqueOrThrow({
    where: { slug: reviewSlug },
    include: { versions: true },
  });
  versionId = review.versions[0]!.id;
}, 60_000);

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

describe.sequential("claim monitoring and passports", () => {
  it("opens a human-reviewable proposal for exactly the claims citing a changed work", async () => {
    const { monitoring } = runtime;
    await expect(
      monitoring.registerCitationStatus(user, {
        doi: RETRACTED_DOI,
        status: "retracted",
        source: "test",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // DOI arrives in resolver-URL form; canonical aliases must still match.
    const result = await monitoring.registerCitationStatus(editor, {
      doi: `https://doi.org/${RETRACTED_DOI.toUpperCase()}`,
      status: "retracted",
      source: "publisher notice",
      note: "Retraction issued by the journal.",
    });
    expect(result.workAlias).toBe(`doi:${RETRACTED_DOI}`);
    expect(result.proposalsOpened).toBe(1);

    const open = await monitoring.listOpenProposals();
    expect(open).toHaveLength(1);
    expect(open[0]!.claimLocalId).toBe("claim-hit");
    expect(open[0]!.citationStatus).toBe("retracted");
    expect(open[0]!.reviewSlug).toBe(reviewSlug);

    // The untouched claim is unaffected; alert counts are per-claim.
    const counts = await runtime.monitoring.getClaimAlertCounts(versionId);
    expect(counts.get("claim-hit")).toBe(1);
    expect(counts.has("claim-miss")).toBe(false);

    // Living-review CI surface.
    const feed = await monitoring.listProposalsForSlug(reviewSlug);
    expect(feed?.openCount).toBe(1);
    expect(await monitoring.listProposalsForSlug("unknown-slug")).toBeNull();

    // Editors were notified.
    const notifications = await runtime.prisma.notification.findMany({
      where: { userId: editor.id, kind: "evidence-alert" },
    });
    expect(notifications.length).toBeGreaterThan(0);
  }, 30_000);

  it("keeps passports stable, lineage deterministic, and resolutions attributable", async () => {
    const { monitoring } = runtime;
    const passport = await monitoring.getClaimPassport(versionId, "claim-hit");
    expect(passport).not.toBeNull();
    expect(passport!.evidence).toHaveLength(1);
    expect(passport!.evidence[0]!.sourceLocation).toBe("content/review.md#L42");
    expect(passport!.alerts.filter((alert) => alert.status === "open")).toHaveLength(1);
    expect(passport!.lineage).toHaveLength(1);
    expect(passport!.lineage[0]!.isThisVersion).toBe(true);
    expect(await monitoring.getClaimPassport(versionId, "no-such-claim")).toBeNull();

    const proposalId = (await monitoring.listOpenProposals())[0]!.id;
    await expect(
      monitoring.resolveProposal(user, proposalId, {
        resolution: "dismissed",
        note: "Non-editors must be refused.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await monitoring.resolveProposal(editor, proposalId, {
      resolution: "resolved-no-action",
      note: "The claim is qualified and does not rely on the retracted analysis.",
    });
    await expect(
      monitoring.resolveProposal(editor, proposalId, {
        resolution: "dismissed",
        note: "A second resolution must be refused.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(await monitoring.listOpenProposals()).toHaveLength(0);
    const feed = await monitoring.listProposalsForSlug(reviewSlug);
    expect(feed?.openCount).toBe(0);
    expect(feed?.proposals[0]!.resolutionNote).toContain("qualified");
    expect(feed?.proposals[0]!.resolvedByLogin).toBe("mon-editor");

    // Re-registering the same signal opens a fresh, separately reviewable
    // proposal (append-only signals), never resurrects the resolved one.
    const again = await monitoring.registerCitationStatus(editor, {
      doi: RETRACTED_DOI,
      status: "corrected",
      source: "second notice",
    });
    expect(again.proposalsOpened).toBe(1);
  }, 30_000);
});

function inspectionReport(): InspectionReport {
  return {
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: "lab",
      name: "monitored-review",
      canonicalUrl: "https://github.com/lab/monitored-review",
    },
    inspectedAt: nowIso,
    status: "succeeded",
    githubRepositoryId: "801",
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

function fullExtraction(): FullExtraction {
  const provenance = {
    source: "repository-metadata" as const,
    commitSha: commitA,
    extractorVersion: "monitoring-test",
    extractedAt: nowIso,
    confidence: 1,
    warnings: [],
  };
  return {
    metadata: {
      extractorVersion: "monitoring-test",
      extractedAt: nowIso,
      commitSha: commitA,
      fields: {
        title: { value: "Monitored Review", provenance },
        repositoryUrl: { value: "https://github.com/lab/monitored-review", provenance },
        commitSha: { value: commitA, provenance },
      },
      warnings: [],
    },
    manifestPresent: false,
    knowledge,
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
    reviewContentDetected: { detected: true, evidence: ["monitoring fixture"] },
    provenanceDetected: absent,
    trustDataDetected: absent,
    releaseDetected: absent,
    doiDetected: absent,
    overallCompatibility: "compatible",
    levelRationale: ["Monitoring fixture is structurally compatible."],
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
    evidenceDataAvailable: true,
    trustDataAvailable: false,
    validatedAt: nowIso,
  };
}
