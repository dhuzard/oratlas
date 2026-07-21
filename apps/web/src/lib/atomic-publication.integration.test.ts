import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  type CompatibilityReport,
  type InspectionReport,
  type KnowledgeNode,
  type NodeRelationTrustRecord,
  type SubmissionValidationReport,
  type TrustRecord,
} from "@oratlas/contracts";
import {
  createEmptyNodeExtractionReport,
  nodeExtractionReportSchema,
  type FullExtraction,
  type NodeExtractionReport,
} from "@oratlas/extractor";
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
  it("accepts a legacy review-only submission without immutable GitHub identity", async () => {
    const capability = await capture({ githubRepositoryId: nextRepoId() });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const stored = await runtime.prisma.submission.findUniqueOrThrow({
      where: { id: submission.submissionId },
      select: { repositoryId: true },
    });
    await runtime.prisma.repository.update({
      where: { id: stored.repositoryId },
      data: { githubRepositoryId: null },
    });
    await expect(
      runtime.acceptSubmission(submission.submissionId, editorId),
    ).resolves.toMatchObject({
      idempotent: false,
      reviewSlug: expect.any(String),
    });
  });

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

  it("normalizes a canonical legacy capture without node extraction", async () => {
    const capability = await capture({ githubRepositoryId: nextRepoId() });
    const legacyPayload = JSON.parse(capability.payloadJson);
    legacyPayload.schemaVersion = "1.0.0";
    delete legacyPayload.extraction.nodeExtraction;
    const payloadJson = canonicalJson(legacyPayload);
    await runtime.prisma.inspectionCapture.update({
      where: { tokenHash: sha256(capability.token) },
      data: { payloadJson, payloadHash: sha256(payloadJson) },
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(submission.submissionId, editorId);
    expect(accepted.reviewSlug).toBeTruthy();
    expect(accepted.nodeVersionIds).toEqual([]);
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

  it("publishes all four node kinds from a node-only capture without creating a review", async () => {
    const nodes = knowledgeNodes();
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(nodes),
      reviewContentDetected: false,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const storedPayload = await runtime.prisma.submission.findUniqueOrThrow({
      where: { id: submission.submissionId },
      select: { submittedPayloadJson: true },
    });
    expect(JSON.parse(storedPayload.submittedPayloadJson!)).toMatchObject({
      schemaVersion: "1.1.0",
      publicationTargets: { proseReview: false, knowledgeNodes: true },
    });

    const accepted = await runtime.acceptSubmission(
      submission.submissionId,
      editorId,
      undefined,
      [],
      nodes.map((node) => node.id),
    );
    expect(accepted.reviewSlug).toBeUndefined();
    expect(accepted.nodeVersionIds).toHaveLength(4);
    expect(
      await runtime.prisma.reviewVersion.count({
        where: { sourceSubmissionId: submission.submissionId },
      }),
    ).toBe(0);
    const versions = await runtime.prisma.knowledgeNodeVersion.findMany({
      where: { sourceSubmissionId: submission.submissionId },
      include: { knowledgeNode: true },
    });
    expect(new Set(versions.map((version) => version.knowledgeNode.kind))).toEqual(
      new Set(["claim", "figure", "dataset", "code"]),
    );
    expect(versions.every((version) => version.inspectionCaptureId)).toBe(true);
    expect(versions.every((version) => version.capturePayloadHash === capability.payloadHash)).toBe(
      true,
    );
    expect(await runtime.prisma.nodeEdge.count()).toBe(0);
  });

  it("retains selected author edges as private proposals and drops dangling local declarations", async () => {
    const nodes = knowledgeNodes().slice(0, 3);
    const edge = {
      sourceNodeId: nodes[0]!.id,
      targetNodeId: nodes[2]!.id,
      relationType: "uses-dataset",
      provenance: "confirmed-by-editor",
      status: "confirmed",
      rationale: "The captured claim uses the captured dataset.",
    };
    const bothCapture = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(nodes, [edge]),
      reviewContentDetected: false,
    });
    const bothSubmission = await runtime.createSubmission({
      inspectionToken: bothCapture.token,
      submitterId,
    });
    await runtime.acceptSubmission(
      bothSubmission.submissionId,
      editorId,
      undefined,
      [],
      [nodes[0]!.id, nodes[2]!.id],
    );
    const proposal = await runtime.prisma.nodeEdgeProposal.findFirstOrThrow({
      where: { sourceSubmissionId: bothSubmission.submissionId },
    });
    expect(proposal).toMatchObject({
      origin: "asserted-by-author",
      status: "proposed",
      relationType: "uses-dataset",
      inspectionCaptureId: expect.any(String),
    });
    expect(await runtime.prisma.nodeEdge.count({ where: { relationType: "uses-dataset" } })).toBe(
      0,
    );
    expect(
      await runtime.prisma.auditEvent.count({
        where: { action: "node-edge.asserted", subjectId: proposal.id },
      }),
    ).toBe(1);

    const partialCapture = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(nodes, [edge]),
      reviewContentDetected: false,
    });
    const partialSubmission = await runtime.createSubmission({
      inspectionToken: partialCapture.token,
      submitterId,
    });
    await runtime.acceptSubmission(
      partialSubmission.submissionId,
      editorId,
      undefined,
      [],
      [nodes[0]!.id],
    );
    expect(
      await runtime.prisma.nodeEdgeProposal.count({
        where: { sourceSubmissionId: partialSubmission.submissionId },
      }),
    ).toBe(0);
  });

  it("atomically replays claim TRUST and keeps concurrent changed lineages append-only", async () => {
    const record: TrustRecord = {
      claimId: "claim-race",
      citationId: "citation-race",
      protocolVersion: "trust-poc-1.0",
      assessorType: "human",
      assessorId: "race-reviewer",
      assessedAt: nowIso,
      criteria: { entailment: { rating: "high", status: "assessed" } },
      reviewStatus: "human-reviewed",
    };
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      knowledge: {
        claims: [{ id: record.claimId, text: "Concurrent replay claim." }],
        citations: [{ id: record.citationId, title: "Concurrent replay source." }],
        relations: [
          {
            claimId: record.claimId,
            citationId: record.citationId,
            relationType: "supports",
          },
        ],
        trust: [record],
        warnings: [],
      },
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    await runtime.acceptSubmission(submission.submissionId, editorId);
    const stored = await runtime.prisma.trustAssessment.findFirstOrThrow({
      where: {
        relation: { claim: { reviewVersion: { sourceSubmissionId: submission.submissionId } } },
      },
    });
    const ingestion = await import("./assessment-ingestion");
    await Promise.all(
      Array.from({ length: 8 }, () =>
        runtime.prisma.$transaction((tx) =>
          ingestion.ingestTrustAssessment(tx, stored.claimEvidenceRelationId, record, null),
        ),
      ),
    );
    expect(
      await runtime.prisma.trustAssessment.count({
        where: { claimEvidenceRelationId: stored.claimEvidenceRelationId },
      }),
    ).toBe(1);

    const changedRecords: TrustRecord[] = ["low", "moderate"].map((rating) => ({
      ...record,
      criteria: {
        entailment: { rating: rating as "low" | "moderate", status: "assessed" },
      },
    }));
    await Promise.all(
      changedRecords.map((changed) =>
        runtime.prisma.$transaction((tx) =>
          ingestion.ingestTrustAssessment(tx, stored.claimEvidenceRelationId, changed, null),
        ),
      ),
    );
    const lineage = await runtime.prisma.trustAssessment.findMany({
      where: { claimEvidenceRelationId: stored.claimEvidenceRelationId },
      orderBy: { createdAt: "asc" },
    });
    expect(lineage).toHaveLength(3);
    const changedLineage = lineage.filter((row) => row.id !== stored.id);
    const changedById = new Map(changedLineage.map((row) => [row.id, row]));
    for (const row of changedLineage) {
      expect(row.supersedesAssessmentId).not.toBe(row.id);
      expect([stored.id, ...changedById.keys()]).toContain(row.supersedesAssessmentId);
      const predecessor = changedById.get(row.supersedesAssessmentId ?? "");
      expect(predecessor?.supersedesAssessmentId ?? stored.id).toBe(stored.id);
    }

    const independent = await runtime.prisma.$transaction((tx) =>
      ingestion.ingestTrustAssessment(
        tx,
        stored.claimEvidenceRelationId,
        { ...record, assessorId: "independent-reviewer" },
        null,
      ),
    );
    expect(independent.supersedesAssessmentId).toBeNull();
  });

  it("persists node-relation TRUST through acceptance, CAS review, public confirmation, and supersession", async () => {
    const [claim, , dataset] = knowledgeNodes();
    const edge = {
      sourceNodeId: claim!.id,
      targetNodeId: dataset!.id,
      relationType: "uses-dataset",
    };
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      knowledge: nodeRelationTrustKnowledge(),
      nodeExtraction: nodeReport([claim!, dataset!], [edge]),
      reviewContentDetected: false,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const accepted = await runtime.acceptSubmission(
      submission.submissionId,
      editorId,
      undefined,
      [],
      [claim!.id, dataset!.id],
    );
    expect(accepted.reviewSlug).toBeUndefined();

    const trust = await import("./trust-provenance");
    const graphTrust = await import("./graph-trust-provider");
    const graphTrustKey = await import("./graph-trust");
    const lifecycle = await import("./node-edge-lifecycle");
    const publication = await import("./node-publication");
    const assessment = await runtime.prisma.nodeRelationTrustAssessment.findFirstOrThrow({
      where: { proposal: { sourceSubmissionId: submission.submissionId } },
      include: trust.loadedNodeRelationTrustInclude,
    });
    const ingestion = await import("./assessment-ingestion");
    const importedNodeRecord = nodeRelationTrustKnowledge().trust[0] as NodeRelationTrustRecord;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        runtime.prisma.$transaction((tx) =>
          ingestion.ingestNodeRelationTrustAssessment(
            tx,
            assessment.nodeEdgeProposalId,
            importedNodeRecord,
          ),
        ),
      ),
    );
    expect(
      await runtime.prisma.nodeRelationTrustAssessment.count({
        where: { nodeEdgeProposalId: assessment.nodeEdgeProposalId },
      }),
    ).toBe(1);
    expect(assessment.nodeEdgeProposalId).toBe(assessment.proposal.id);
    expect(JSON.parse(assessment.sourceRecordJson)).toMatchObject({
      subjectType: "node-relation",
      subject: { claimNodeId: claim!.id, evidenceNodeId: dataset!.id },
    });
    expect(assessment.proposal.status).toBe("proposed");
    expect(trust.resolveLoadedNodeRelationTrustAssessment(assessment).authoritative).toBe(false);
    const exactTrustKey = {
      sourceVersionId: assessment.proposal.sourceNodeVersionId,
      targetVersionId: assessment.proposal.targetNodeVersionId,
      relationType: "uses-dataset" as const,
    };
    expect(await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).toEqual(new Map());

    const sourceNodeId = assessment.proposal.sourceNodeVersion.knowledgeNode.id;
    expect((await publication.getPublicNode(sourceNodeId))?.edges).toEqual([]);
    const queuedBefore = (await trust.listTrustEditorialQueue("all")).find(
      (item) => item.assessmentId === assessment.id,
    );
    expect(queuedBefore).toMatchObject({
      canVerify: false,
      subjectHref: `/nodes/${sourceNodeId}/versions/${assessment.proposal.sourceNodeVersionId}`,
      computedAggregateScore: null,
    });

    const confirmed = await lifecycle.decideNodeEdgeProposal(
      { id: editorId, role: "EDITOR" },
      assessment.proposal.id,
      {
        decision: "confirm",
        expectedRevision: 0,
        note: "The editor checked the exact claim and dataset versions.",
      },
    );
    expect(confirmed.status).toBe("confirmed");
    const loaded = await runtime.prisma.nodeRelationTrustAssessment.findUniqueOrThrow({
      where: { id: assessment.id },
      include: trust.loadedNodeRelationTrustInclude,
    });
    const resolved = trust.resolveLoadedNodeRelationTrustAssessment(loaded);
    expect(resolved.authoritative).toBe(true);
    expect(
      (await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).get(
        graphTrustKey.graphTrustLookupKey(exactTrustKey),
      ),
    ).toMatchObject({
      protocolVersion: "trust-poc-1.0",
      assessorType: "agent",
      assessorId: "repository-agent",
      reviewStatus: "unverified-import",
      verificationState: "unverified-import",
    });
    expect(
      await graphTrust.databaseGraphTrustProvider.lookup([
        { ...exactTrustKey, relationType: "supports" },
      ]),
    ).toEqual(new Map());
    await runtime.prisma.user.update({ where: { id: editorId }, data: { role: "USER" } });
    expect(await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).toEqual(new Map());
    await runtime.prisma.user.update({ where: { id: editorId }, data: { role: "EDITOR" } });

    await expect(
      trust.verifyTrustAssessment(
        {
          assessmentId: assessment.id,
          subjectType: "node-relation",
          status: "human-reviewed",
          rationale: "The exact relation evidence and provenance were checked.",
          expectedRevision: 0,
          expectedAssessmentHash: "0".repeat(64),
        },
        { id: editorId, role: "EDITOR" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await runtime.prisma.nodeRelationTrustVerification.count({
        where: { nodeRelationTrustAssessmentId: assessment.id },
      }),
    ).toBe(0);

    await trust.verifyTrustAssessment(
      {
        assessmentId: assessment.id,
        subjectType: "node-relation",
        status: "human-reviewed",
        rationale: "The exact relation evidence and provenance were checked.",
        expectedRevision: 0,
        expectedAssessmentHash: resolved.currentHash,
      },
      { id: editorId, role: "EDITOR" },
    );
    const publicNode = await publication.getPublicNode(sourceNodeId);
    expect(publicNode?.edges).toHaveLength(1);
    expect(publicNode?.edges[0]?.trust).toMatchObject({
      assessmentId: assessment.id,
      protocolVersion: "trust-poc-1.0",
      reviewStatus: "human-reviewed",
      verificationState: "platform-verified",
    });
    expect((await lifecycle.listConfirmedEdgesForNode(sourceNodeId))[0]?.trust).toEqual(
      publicNode?.edges[0]?.trust,
    );
    expect(
      (await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).get(
        graphTrustKey.graphTrustLookupKey(exactTrustKey),
      ),
    ).toMatchObject({
      assessmentId: assessment.id,
      protocolVersion: "trust-poc-1.0",
      assessorType: "agent",
      assessorId: "repository-agent",
      assessedAt: nowIso,
      reviewStatus: "human-reviewed",
      verificationState: "platform-verified",
    });
    await expect(
      trust.verifyTrustAssessment(
        {
          assessmentId: assessment.id,
          subjectType: "node-relation",
          status: "adjudicated",
          rationale: "This stale queue revision must lose the compare-and-set race.",
          expectedRevision: 0,
          expectedAssessmentHash: resolved.currentHash,
        },
        { id: editorId, role: "EDITOR" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await runtime.prisma.nodeRelationTrustVerification.count({
        where: { nodeRelationTrustAssessmentId: assessment.id },
      }),
    ).toBe(1);

    await runtime.prisma.nodeRelationTrustVerification.update({
      where: { nodeRelationTrustAssessmentId: assessment.id },
      data: { assessmentHash: "f".repeat(64) },
    });
    expect(
      (await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).get(
        graphTrustKey.graphTrustLookupKey(exactTrustKey),
      ),
    ).toMatchObject({
      assessmentId: assessment.id,
      protocolVersion: "trust-poc-1.0",
      assessorType: "agent",
      assessorId: "repository-agent",
      assessedAt: nowIso,
      reviewStatus: "unverified-import",
      verificationState: "stale-verification",
    });
    expect((await publication.getPublicNode(sourceNodeId))?.edges[0]?.trust).toMatchObject({
      assessmentId: assessment.id,
      reviewStatus: "unverified-import",
      verificationState: "stale-verification",
    });
    await runtime.prisma.nodeRelationTrustVerification.update({
      where: { nodeRelationTrustAssessmentId: assessment.id },
      data: { assessmentHash: resolved.currentHash },
    });

    const verifiedLoaded = await runtime.prisma.nodeRelationTrustAssessment.findUniqueOrThrow({
      where: { id: assessment.id },
      include: trust.loadedNodeRelationTrustInclude,
    });
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      proposal: _proposal,
      verification: _verification,
      sourceRecordHash: _sourceRecordHash,
      sourceLineageKey: _sourceLineageKey,
      supersedesAssessmentId: _supersedesAssessmentId,
      ...cloneData
    } = verifiedLoaded;
    await runtime.prisma.nodeRelationTrustAssessment.create({
      data: { ...cloneData, assessedAt: new Date("2027-01-01T00:00:00.000Z") },
    });
    expect(
      (await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).get(
        graphTrustKey.graphTrustLookupKey(exactTrustKey),
      ),
    ).toEqual([
      expect.objectContaining({
        reviewStatus: "human-reviewed",
        verificationState: "platform-verified",
      }),
      expect.objectContaining({
        reviewStatus: "unverified-import",
        verificationState: "unverified-import",
      }),
    ]);

    await runtime.prisma.nodeRelationTrustAssessment.create({
      data: {
        ...cloneData,
        protocolVersion: "x".repeat(121),
        assessedAt: new Date("2027-01-01T01:00:00.000Z"),
      },
    });
    expect(
      (await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).get(
        graphTrustKey.graphTrustLookupKey(exactTrustKey),
      ),
    ).toEqual([
      expect.objectContaining({
        reviewStatus: "human-reviewed",
        verificationState: "platform-verified",
      }),
      expect.objectContaining({
        reviewStatus: "unverified-import",
        verificationState: "unverified-import",
      }),
    ]);

    await runtime.prisma.nodeRelationTrustAssessment.createMany({
      data: Array.from({ length: 48 }, (_, index) => ({
        ...cloneData,
        assessedAt: new Date(Date.UTC(2027, 0, 2, 0, 0, index)),
      })),
    });
    expect(
      (await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).get(
        graphTrustKey.graphTrustLookupKey(exactTrustKey),
      ),
    ).toHaveLength(50);
    const publicEdgeWithCompleteAssessments = (await publication.getPublicNode(sourceNodeId))
      ?.edges[0];
    expect(publicEdgeWithCompleteAssessments?.trust).toBeUndefined();
    expect(publicEdgeWithCompleteAssessments?.trustAssessments).toHaveLength(50);

    await lifecycle.decideNodeEdgeProposal(
      { id: editorId, role: "EDITOR" },
      assessment.proposal.id,
      {
        decision: "supersede",
        expectedRevision: 1,
        note: "A newer editorial relation decision replaces this exact predicate.",
      },
    );
    expect(
      await runtime.prisma.nodeRelationTrustAssessment.count({ where: { id: assessment.id } }),
    ).toBe(1);
    expect((await publication.getPublicNode(sourceNodeId))?.edges).toEqual([]);
    expect(await graphTrust.databaseGraphTrustProvider.lookup([exactTrustKey])).toEqual(new Map());
    const stale = await runtime.prisma.nodeRelationTrustAssessment.findUniqueOrThrow({
      where: { id: assessment.id },
      include: trust.loadedNodeRelationTrustInclude,
    });
    expect(trust.resolveLoadedNodeRelationTrustAssessment(stale)).toMatchObject({
      authoritative: false,
      state: "stale-verification",
    });
  });

  it("skips node-relation TRUST for partial and prose-only acceptance", async () => {
    const [claim, , dataset] = knowledgeNodes();
    const edge = {
      sourceNodeId: claim!.id,
      targetNodeId: dataset!.id,
      relationType: "uses-dataset",
    };
    const partialCapture = await capture({
      githubRepositoryId: nextRepoId(),
      knowledge: nodeRelationTrustKnowledge(),
      nodeExtraction: nodeReport([claim!, dataset!], [edge]),
      reviewContentDetected: false,
    });
    const partial = await runtime.createSubmission({
      inspectionToken: partialCapture.token,
      submitterId,
    });
    await runtime.acceptSubmission(partial.submissionId, editorId, undefined, [], [claim!.id]);
    expect(
      await runtime.prisma.nodeRelationTrustAssessment.count({
        where: { proposal: { sourceSubmissionId: partial.submissionId } },
      }),
    ).toBe(0);

    const proseCapture = await capture({
      githubRepositoryId: nextRepoId(),
      knowledge: nodeRelationTrustKnowledge(),
      nodeExtraction: nodeReport([claim!, dataset!], [edge]),
      reviewContentDetected: true,
    });
    const prose = await runtime.createSubmission({
      inspectionToken: proseCapture.token,
      submitterId,
    });
    const proseAccepted = await runtime.acceptSubmission(prose.submissionId, editorId);
    expect(proseAccepted.reviewSlug).toBeTruthy();
    expect(proseAccepted.nodeVersionIds).toEqual([]);
    expect(
      await runtime.prisma.nodeRelationTrustAssessment.count({
        where: { proposal: { sourceSubmissionId: prose.submissionId } },
      }),
    ).toBe(0);
  });

  it("resolves an exact cross-lab author target and fails closed when it is missing", async () => {
    const [claim, , dataset] = knowledgeNodes();
    const targetRepositoryId = nextRepoId();
    const targetCapture = await capture({
      githubRepositoryId: targetRepositoryId,
      nodeExtraction: nodeReport([dataset!]),
      reviewContentDetected: false,
    });
    const targetSubmission = await runtime.createSubmission({
      inspectionToken: targetCapture.token,
      submitterId,
    });
    const targetResult = await runtime.acceptSubmission(
      targetSubmission.submissionId,
      editorId,
      undefined,
      [],
      [dataset!.id],
    );
    const externalEdge = {
      sourceNodeId: claim!.id,
      targetNodeId: dataset!.id,
      relationType: "uses-dataset",
      targetRepository: { githubRepositoryId: targetRepositoryId, commitSha: commitA },
    };
    const sourceCapture = await capture({
      githubRepositoryId: nextRepoId(),
      knowledge: nodeRelationTrustKnowledge({
        githubRepositoryId: targetRepositoryId,
        commitSha: commitA,
      }),
      nodeExtraction: nodeReport([claim!], [externalEdge]),
      reviewContentDetected: false,
    });
    const sourceSubmission = await runtime.createSubmission({
      inspectionToken: sourceCapture.token,
      submitterId,
    });
    await runtime.acceptSubmission(
      sourceSubmission.submissionId,
      editorId,
      undefined,
      [],
      [claim!.id],
    );
    const externalProposal = await runtime.prisma.nodeEdgeProposal.findFirstOrThrow({
      where: { sourceSubmissionId: sourceSubmission.submissionId },
      include: { trustAssessments: true },
    });
    expect(externalProposal).toMatchObject({
      targetNodeVersionId: targetResult.nodeVersionIds[0],
      trustAssessments: [{ nodeEdgeProposalId: externalProposal.id }],
    });
    const lifecycle = await import("./node-edge-lifecycle");
    await lifecycle.decideNodeEdgeProposal({ id: editorId, role: "EDITOR" }, externalProposal.id, {
      decision: "reject",
      expectedRevision: 0,
      note: "The editor rejected this imported cross-repository predicate.",
    });
    expect(
      await runtime.prisma.nodeRelationTrustAssessment.count({
        where: { nodeEdgeProposalId: externalProposal.id },
      }),
    ).toBe(1);
    const graphTrust = await import("./graph-trust-provider");
    expect(
      await graphTrust.databaseGraphTrustProvider.lookup([
        {
          sourceVersionId: externalProposal.sourceNodeVersionId,
          targetVersionId: externalProposal.targetNodeVersionId,
          relationType: "uses-dataset",
        },
      ]),
    ).toEqual(new Map());

    const missingCapture = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(
        [claim!],
        [
          {
            ...externalEdge,
            targetRepository: { githubRepositoryId: "999999999", commitSha: commitA },
          },
        ],
      ),
      reviewContentDetected: false,
    });
    const missingSubmission = await runtime.createSubmission({
      inspectionToken: missingCapture.token,
      submitterId,
    });
    await expect(
      runtime.acceptSubmission(
        missingSubmission.submissionId,
        editorId,
        undefined,
        [],
        [claim!.id],
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await runtime.prisma.nodeEdgeProposal.count({
        where: { sourceSubmissionId: missingSubmission.submissionId },
      }),
    ).toBe(0);
    expect(
      await runtime.prisma.knowledgeNodeVersion.count({
        where: { sourceSubmissionId: missingSubmission.submissionId },
      }),
    ).toBe(0);
  });

  it("flags example DOIs from every embedded node location even when report references are incomplete", async () => {
    const [claim, figure, dataset] = knowledgeNodes();
    const nodes = [
      {
        ...claim!,
        id: "claim:example-version-doi",
        versionDoi: "10.5555/oratlas.example.version",
        conceptDoi: "10.5281/zenodo.2000001",
      },
      {
        ...figure!,
        id: "figure:example-concept-doi",
        versionDoi: "10.5281/zenodo.2000002",
        conceptDoi: "10.5555/oratlas.example.concept",
      },
      {
        ...dataset!,
        id: "dataset:example-payload-doi",
        versionDoi: "10.5281/zenodo.2000003",
        conceptDoi: "10.5281/zenodo.2000004",
        payload: {
          ...dataset!.payload,
          doi: "10.5555/oratlas.example.dataset",
        },
      },
    ] as KnowledgeNode[];
    const extraction = nodeReport(nodes);
    extraction.nodes[2]!.doiReferences = [
      {
        field: "versionDoi",
        input: "10.5281/zenodo.2000003",
        normalizedDoi: "10.5281/zenodo.2000003",
        isZenodo: true,
        isExample: false,
      },
    ];
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeExtractionReportSchema.parse(extraction),
      reviewContentDetected: false,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    await runtime.acceptSubmission(
      submission.submissionId,
      editorId,
      undefined,
      [],
      nodes.map((node) => node.id),
    );
    const versions = await runtime.prisma.knowledgeNodeVersion.findMany({
      where: { sourceSubmissionId: submission.submissionId },
      include: { knowledgeNode: true },
    });
    const byLocalId = new Map(
      versions.map((version) => [version.knowledgeNode.localNodeId, version]),
    );
    expect([...byLocalId.values()].every((version) => version.isExample)).toBe(true);
    expect(byLocalId.get("claim:example-version-doi")).toMatchObject({
      versionDoi: "10.5555/oratlas.example.version",
      conceptDoi: "10.5281/zenodo.2000001",
    });
    expect(byLocalId.get("figure:example-concept-doi")).toMatchObject({
      versionDoi: "10.5281/zenodo.2000002",
      conceptDoi: "10.5555/oratlas.example.concept",
    });
    expect(byLocalId.get("dataset:example-payload-doi")).toMatchObject({
      versionDoi: "10.5281/zenodo.2000003",
      conceptDoi: "10.5281/zenodo.2000004",
    });
    expect(JSON.parse(byLocalId.get("dataset:example-payload-doi")!.payloadJson)).toMatchObject({
      doi: "10.5555/oratlas.example.dataset",
    });
  });

  it("publishes an exact subset idempotently and rejects a different retry selection", async () => {
    const nodes = knowledgeNodes().slice(0, 2);
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(nodes),
      reviewContentDetected: false,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const selected = [nodes[1]!.id];
    const first = await runtime.acceptSubmission(
      submission.submissionId,
      editorId,
      undefined,
      [],
      selected,
    );
    const retry = await runtime.acceptSubmission(
      submission.submissionId,
      editorId,
      undefined,
      [],
      selected,
    );
    expect(first.nodeVersionIds).toHaveLength(1);
    expect(retry).toMatchObject({
      selectedNodeIds: selected,
      nodeVersionIds: first.nodeVersionIds,
      idempotent: true,
    });
    await expect(
      runtime.acceptSubmission(submission.submissionId, editorId, undefined, [], [nodes[0]!.id]),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await runtime.prisma.auditEvent.count({
        where: { action: "knowledge-node.published", subjectId: { not: "" } },
      }),
    ).toBeGreaterThan(0);
  });

  it("rejects candidate tampering and rolls the entire acceptance back", async () => {
    const nodes = knowledgeNodes().slice(0, 1);
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(nodes),
      reviewContentDetected: false,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const row = await runtime.prisma.submission.findUniqueOrThrow({
      where: { id: submission.submissionId },
    });
    const payload = JSON.parse(row.submittedPayloadJson!);
    payload.nodeExtraction.nodes[0].node.title = "Tampered title";
    const payloadJson = canonicalJson(payload);
    await runtime.prisma.submission.update({
      where: { id: submission.submissionId },
      data: { submittedPayloadJson: payloadJson, submittedPayloadHash: sha256(payloadJson) },
    });
    await expect(
      runtime.acceptSubmission(submission.submissionId, editorId, undefined, [], [nodes[0]!.id]),
    ).rejects.toThrow("immutable inspection capture");
    expect(
      await runtime.prisma.submission.findUniqueOrThrow({
        where: { id: submission.submissionId },
        select: { status: true },
      }),
    ).toEqual({ status: "pending-editorial-review" });
    expect(
      await runtime.prisma.knowledgeNodeVersion.count({
        where: { sourceSubmissionId: submission.submissionId },
      }),
    ).toBe(0);
  });

  it("rolls back cross-capture, repository, commit, and hash binding mismatches", async () => {
    const nodes = knowledgeNodes().slice(0, 1);
    const capability = await capture({
      githubRepositoryId: nextRepoId(),
      nodeExtraction: nodeReport(nodes),
      reviewContentDetected: false,
    });
    const submission = await runtime.createSubmission({
      inspectionToken: capability.token,
      submitterId,
    });
    const stored = await runtime.prisma.submission.findUniqueOrThrow({
      where: { id: submission.submissionId },
      include: { inspectionCapture: true },
    });
    const accept = () =>
      runtime.acceptSubmission(submission.submissionId, editorId, undefined, [], [nodes[0]!.id]);

    await runtime.prisma.inspectionCapture.update({
      where: { id: stored.inspectionCaptureId! },
      data: { commitSha: "c".repeat(40) },
    });
    await expect(accept()).rejects.toThrow("capture commit mismatch");
    await runtime.prisma.inspectionCapture.update({
      where: { id: stored.inspectionCaptureId! },
      data: {
        commitSha: stored.inspectionCapture!.commitSha,
        githubRepositoryId: "different-github-repository",
      },
    });
    await expect(accept()).rejects.toThrow("capture repository identity mismatch");
    await runtime.prisma.inspectionCapture.update({
      where: { id: stored.inspectionCaptureId! },
      data: { githubRepositoryId: stored.inspectionCapture!.githubRepositoryId },
    });

    await runtime.prisma.submission.update({
      where: { id: submission.submissionId },
      data: { submittedPayloadHash: "0".repeat(64) },
    });
    await expect(accept()).rejects.toThrow("payload integrity");
    await runtime.prisma.submission.update({
      where: { id: submission.submissionId },
      data: { submittedPayloadHash: stored.submittedPayloadHash },
    });

    const other = await capture({ githubRepositoryId: nextRepoId() });
    const otherCapture = await runtime.prisma.inspectionCapture.findUniqueOrThrow({
      where: { tokenHash: sha256(other.token) },
    });
    await runtime.prisma.submission.update({
      where: { id: submission.submissionId },
      data: { inspectionCaptureId: otherCapture.id },
    });
    await expect(accept()).rejects.toThrow("immutable inspection capture");
    await runtime.prisma.submission.update({
      where: { id: submission.submissionId },
      data: { inspectionCaptureId: stored.inspectionCaptureId },
    });

    expect((await accept()).nodeVersionIds).toHaveLength(1);
    expect(
      await runtime.prisma.knowledgeNodeVersion.count({
        where: { sourceSubmissionId: submission.submissionId },
      }),
    ).toBe(1);
  });

  it("leaves node candidates private after reject and request-changes decisions", async () => {
    for (const decision of ["reject", "request-changes"] as const) {
      const nodes = knowledgeNodes().slice(0, 1);
      const capability = await capture({
        githubRepositoryId: nextRepoId(),
        nodeExtraction: nodeReport(nodes),
        reviewContentDetected: false,
      });
      const submission = await runtime.createSubmission({
        inspectionToken: capability.token,
        submitterId,
      });
      await runtime.decideSubmission(submission.submissionId, editorId, decision);
      expect(
        await runtime.prisma.knowledgeNodeVersion.count({
          where: { sourceSubmissionId: submission.submissionId },
        }),
      ).toBe(0);
      expect(
        await runtime.prisma.auditEvent.count({
          where: { idempotencyKey: `submission.${decision}:${submission.submissionId}` },
        }),
      ).toBe(1);
    }
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
  nodeExtraction?: NodeExtractionReport;
  reviewContentDetected?: boolean;
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
    options.nodeExtraction,
    options.reviewContentDetected,
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
  nodeExtraction?: NodeExtractionReport,
  reviewContentDetected = true,
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
    nodeExtraction:
      nodeExtraction ??
      createEmptyNodeExtractionReport({
        commitSha: report.selectedSource!.commitSha,
        extractorVersion: "integration-test",
      }),
    compatibility: compatibilityReport(reviewContentDetected),
  };
}

function compatibilityReport(reviewContentDetected = true): CompatibilityReport {
  const absent = { detected: false, evidence: [] };
  return {
    schemaVersion: "1.0.0",
    templateForkDetected: absent,
    templateFilesDetected: absent,
    mystProjectDetected: absent,
    bibliographyDetected: absent,
    reviewContentDetected: reviewContentDetected
      ? { detected: true, evidence: ["integration fixture"] }
      : absent,
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
  expect(versions.every((version) => version.snapshot?.sourceKind === null)).toBe(true);
  expect(versions.every((version) => version.snapshot?.releaseTag === null)).toBe(true);
}

function knowledgeNodes(): KnowledgeNode[] {
  const shared = {
    abstract: "A bounded publication object.",
    contributors: [{ displayName: "Ada Researcher" }],
    license: "CC-BY-4.0",
    provenance: {
      sourcePath: "nodes/publications.json",
      repositoryUrl: "https://github.com/lab/nodes",
      commitSha: commitA,
    },
  };
  return [
    {
      ...shared,
      id: "claim:result",
      kind: "claim",
      title: "Primary claim",
      text: "The intervention changed the measured outcome.",
      payload: { statement: "The intervention changed the measured outcome.", qualifiers: [] },
    },
    {
      ...shared,
      id: "figure:main",
      kind: "figure",
      title: "Main figure",
      payload: { artifactPath: "figures/main.png", caption: "Measured outcome by condition." },
    },
    {
      ...shared,
      id: "dataset:observations",
      kind: "dataset",
      title: "Observations",
      versionDoi: "10.5281/zenodo.1234567",
      conceptDoi: "10.5281/zenodo.1234566",
      payload: {
        artifactPath: "data/observations.csv",
        format: "text/csv",
        sizeBytes: 42_000,
      },
    },
    {
      ...shared,
      id: "code:analysis",
      kind: "code",
      title: "Analysis code",
      payload: { entryPoints: ["src/analyse.py"], language: "Python", releaseRef: "v1.0.0" },
    },
  ];
}

function nodeReport(nodes: KnowledgeNode[], edges: unknown[] = []): NodeExtractionReport {
  return nodeExtractionReportSchema.parse({
    ...createEmptyNodeExtractionReport({
      commitSha: commitA,
      extractorVersion: "integration-test",
    }),
    manifest: { path: "node-manifest.json", status: "ok", errors: [] },
    nodes: nodes.map((node, index) => ({
      status: "ok",
      sourcePath: "nodes/publications.json",
      sourcePointer: `/${index}`,
      declaredId: node.id,
      node,
      fieldProvenance: {
        title: {
          source: "node-record",
          file: "nodes/publications.json",
          pointer: `/${index}/title`,
          commitSha: commitA,
          extractorVersion: "integration-test",
          confidence: 1,
        },
      },
      doiReferences: [],
      issues: [],
    })),
    edges: edges.map((edge, index) => ({
      status: "ok",
      sourcePath: "nodes/edges.jsonl",
      sourcePointer: `line:${index + 1}`,
      edge,
      issues: [],
    })),
    counts: {
      ok: nodes.length,
      invalid: 0,
      skipped: 0,
      edgesOk: edges.length,
      edgesInvalid: 0,
      edgesSkipped: 0,
    },
  });
}

function nodeRelationTrustKnowledge(evidenceRepository?: {
  githubRepositoryId: string;
  commitSha: string;
}): FullExtraction["knowledge"] {
  return {
    claims: [],
    citations: [],
    relations: [],
    trust: [
      {
        subjectType: "node-relation",
        subject: {
          claimNodeId: "claim:result",
          evidenceNodeId: "dataset:observations",
          evidenceKind: "dataset",
          relationType: "uses-dataset",
          evidenceRepository,
        },
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        assessorId: "repository-agent",
        assessedAt: nowIso,
        criteria: { sourceAccess: { rating: "high", status: "assessed" } },
        aggregateScore: 0.9,
        aggregateMethod: "ordinal-mean-1.0",
        reviewStatus: "agent-proposed",
      },
    ],
    warnings: [],
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
