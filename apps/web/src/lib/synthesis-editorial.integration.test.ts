import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { applyDatabaseGuards, SQLITE_DATABASE_GUARD_NAMES, type PrismaClient } from "@oratlas/db";
import type { SessionUser } from "./auth";
import type * as Editorial from "./synthesis-editorial";
import type * as Staleness from "./synthesis-staleness";
import {
  buildPreparedSubgraphEvidencePacket,
  composeDeterministicSynthesis,
  fingerprintSubgraphEvidenceSelection,
  type LlmProvider,
} from "@oratlas/knowledge";
import {
  canonicalJson,
  type SubgraphEvidenceSource,
  type SynthesisGenerationRequest,
} from "@oratlas/contracts";

vi.mock("server-only", () => ({}));

const fileName = `.tmp-oratlas-synthesis-editorial-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", fileName);
const databaseUrl = `file:./${fileName}`;
let prisma: PrismaClient;
let service: typeof Editorial;
let staleness: typeof Staleness;
let actor: SessionUser;

function prepared(nodeId = "claim") {
  const commitSha = "a".repeat(40);
  const selection = { kind: "seed" as const, nodeId, versionId: `${nodeId}-v1` };
  const source: SubgraphEvidenceSource = {
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: { nodeCount: 1, edgeCount: 0, contradictionEdgeIds: [] },
    nodes: [
      {
        id: nodeId,
        localNodeId: nodeId,
        repository: { owner: "atlas", name: "review", url: "https://github.com/atlas/review" },
        versionId: `${nodeId}-v1`,
        snapshotId: "snapshot-v1",
        commitSha,
        title: "A grounded claim",
        contributors: [{ displayName: "Reviewer" }],
        license: "CC-BY-4.0",
        provenance: {
          sourcePath: "knowledge/claim.json",
          repositoryUrl: "https://github.com/atlas/review",
          commitSha,
        },
        identifiers: [],
        isExample: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "claim",
        payload: { statement: "A grounded claim.", qualifiers: [] },
      },
    ],
    edges: [],
  };
  return buildPreparedSubgraphEvidencePacket(source);
}

const selector: SynthesisGenerationRequest["selector"] = {
  schemaVersion: "synthesis-selector/1.0.0",
  selection: { kind: "seed", nodeId: "claim" },
  depth: 1,
  maxNodes: 10,
  maxEdges: 20,
  relationTypes: ["contradicts"],
  trustPolicy: "authoritative-current-relation-trust-v1",
  currentVersionPolicy: "newest-valid-no-history-fallback",
  topicSeedPolicy: "current-public-title-abstract-search-v1",
  topicSeedLimit: 1,
  edgePolicy: "editor-confirmed-exact-versions-only",
  includeContradictions: true,
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
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
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
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: "utf8",
      },
    );
    execFileSync("sqlite3", [databasePath], { input: ddl, stdio: ["pipe", "pipe", "pipe"] });
  }
  ({ prisma } = await import("./db"));
  await applyDatabaseGuards(prisma, "sqlite");
  service = await import("./synthesis-editorial");
  staleness = await import("./synthesis-staleness");
  const user = await prisma.user.create({
    data: { githubLogin: "editor", displayName: "Atlas Editor", role: "EDITOR" },
  });
  actor = {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: null,
    profileUrl: null,
    role: "EDITOR",
  };
  const repository = await prisma.repository.create({
    data: {
      id: "repository-v1",
      owner: "atlas",
      name: "review",
      canonicalUrl: "https://github.com/atlas/review",
    },
  });
  await prisma.repositorySnapshot.create({
    data: {
      id: "snapshot-v1",
      repositoryId: repository.id,
      commitSha: "a".repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "b".repeat(64),
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: "claim", repositoryId: repository.id, localNodeId: "claim", kind: "claim" },
  });
  await prisma.knowledgeNodeVersion.create({
    data: {
      id: "claim-v1",
      knowledgeNodeId: "claim",
      snapshotId: "snapshot-v1",
      title: "A grounded claim",
      contributorsJson: '[{"displayName":"Reviewer"}]',
      license: "CC-BY-4.0",
      provenanceJson:
        '{"sourcePath":"knowledge/claim.json","repositoryUrl":"https://github.com/atlas/review","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      payloadJson: '{"statement":"A grounded claim.","qualifiers":[]}',
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await prisma.knowledgeNode.create({
    data: {
      id: "claim-reject",
      repositoryId: repository.id,
      localNodeId: "claim-reject",
      kind: "claim",
    },
  });
  await prisma.knowledgeNodeVersion.create({
    data: {
      id: "claim-reject-v1",
      knowledgeNodeId: "claim-reject",
      snapshotId: "snapshot-v1",
      title: "A grounded claim",
      contributorsJson: '[{"displayName":"Reviewer"}]',
      license: "CC-BY-4.0",
      provenanceJson:
        '{"sourcePath":"knowledge/claim.json","repositoryUrl":"https://github.com/atlas/review","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      payloadJson: '{"statement":"A grounded claim.","qualifiers":[]}',
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    for (let attempt = 0; attempt < 6; attempt += 1)
      try {
        if (existsSync(path)) rmSync(path);
        break;
      } catch {
        if (attempt === 5) break;
        await delay(25 * 2 ** attempt);
      }
  }
});

const acceptance = {
  action: "accept" as const,
  expectedRevision: 0,
  idempotencyKey: "accept-request-0001",
  rationale: "The editor reviewed grounding, framing, attribution, limitations and rights.",
  licenseSpdx: "CC-BY-4.0",
  rightsStatement: "The editor confirms publication rights for this grounded synthesis.",
  versionDoi: "10.5281/ZENODO.1234567",
  conceptDoi: "10.5281/ZENODO.1234500",
  checklist: {
    groundingAndCitationsReviewed: true as const,
    contradictionAndNonConsensusFramingReviewed: true as const,
    attributionAndAiDisclosureReviewed: true as const,
    limitationsReviewed: true as const,
    privacyAndInjectionLeakageReviewed: true as const,
    rightsAndLicenseConfirmed: true as const,
  },
};

describe.sequential("synthesis editorial lifecycle", () => {
  it("claims generation idempotently and publishes only after acceptance", async () => {
    const input = { selector, requestKey: "generation-request-0001" };
    const draft = await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      loadPacket: async () => prepared(),
    });
    expect(await prisma.review.count()).toBe(0);
    const duplicate = await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      loadPacket: async () => prepared(),
    });
    expect(duplicate.id).toBe(draft.id);
    expect(await prisma.agentRun.count()).toBe(1);
    await expect(
      service.generateSynthesisDraft(
        { ...input, selector: { ...selector, depth: 2 } },
        { client: prisma, actor, loadPacket: async () => prepared() },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.generateSynthesisDraft(
        {
          selector: { ...selector, selection: { kind: "seed", nodeId: "different-node" } },
          requestKey: "generation-selector-mismatch-0001",
        },
        { client: prisma, actor, loadPacket: async () => prepared() },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await prisma.agentRun.count()).toBe(1);

    const accepted = await service.decideSynthesisDraft(draft.id, acceptance, actor, prisma);
    const replay = await service.decideSynthesisDraft(draft.id, acceptance, actor, prisma);
    expect(replay).toEqual(accepted);
    const publicReview = await service.getPublicSynthesisReview(accepted.reviewSlug!, prisma);
    expect(publicReview).toMatchObject({
      reviewType: "ai-synthesis",
      version: {
        ordinal: 1,
        isCurrent: true,
        versionDoi: "10.5281/zenodo.1234567",
        conceptDoi: "10.5281/zenodo.1234500",
      },
    });
    const acceptedVersion = await prisma.reviewVersion.findUniqueOrThrow({
      where: { id: accepted.reviewVersionId! },
    });
    const acceptedDraft = await prisma.synthesisDraft.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect([acceptedVersion.versionDoi, acceptedVersion.conceptDoi]).toEqual([
      "10.5281/zenodo.1234567",
      "10.5281/zenodo.1234500",
    ]);
    expect([acceptedDraft.versionDoi, acceptedDraft.conceptDoi]).toEqual([
      "10.5281/zenodo.1234567",
      "10.5281/zenodo.1234500",
    ]);
    const serialized = JSON.stringify(publicReview);
    for (const forbidden of [
      "packetJson",
      "selectorJson",
      "agentRunId",
      "requestKey",
      "decisionRationale",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect((await prisma.agentRun.findFirstOrThrow()).humanReviewStatus).toBe("approved");
    await expect(
      service.decideSynthesisDraft(
        draft.id,
        { ...acceptance, rationale: `${acceptance.rationale} Changed.` },
        actor,
        prisma,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("reclaims a stale pre-recorder lease without leaving an orphan run", async () => {
    let clock = new Date("2026-07-16T12:00:00.000Z");
    let providerCalls = 0;
    const provider: LlmProvider = {
      name: "pre-recorder-recovery",
      model: "recovery-model",
      async complete() {
        providerCalls += 1;
        return canonicalJson(composeDeterministicSynthesis(prepared()));
      },
    };
    const input = { selector, requestKey: "generation-pre-recorder-crash-0001" };
    await expect(
      service.generateSynthesisDraft(input, {
        client: prisma,
        actor,
        provider,
        now: () => clock,
        leaseDurationMs: 1_000,
        loadPacket: async () => prepared(),
        afterRequestClaimed: async () => {
          throw new Error("injected-pre-recorder-crash");
        },
      }),
    ).rejects.toThrow("injected-pre-recorder-crash");
    const stranded = await prisma.synthesisGenerationRequestClaim.findUniqueOrThrow({
      where: { requestKey: input.requestKey },
    });
    expect(stranded).toMatchObject({ status: "running", agentRunId: null, attempt: 1 });
    expect(providerCalls).toBe(0);

    clock = new Date(clock.getTime() + 2_000);
    const recovered = await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      provider,
      now: () => clock,
      leaseDurationMs: 1_000,
      loadPacket: async () => prepared(),
    });
    expect(recovered.status).toBe("pending");
    expect(providerCalls).toBe(1);
    expect(
      await prisma.synthesisGenerationRequestClaim.findUniqueOrThrow({
        where: { requestKey: input.requestKey },
      }),
    ).toMatchObject({ status: "completed", attempt: 2 });
  });

  it("evaluates an unchanged accepted head as fresh without generating or publishing", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    const before = {
      runs: await prisma.agentRun.count(),
      drafts: await prisma.synthesisDraft.count(),
      versions: await prisma.reviewVersion.count(),
    };
    const first = await staleness.evaluateSynthesisHead(review.id, { client: prisma });
    const repeated = await staleness.evaluateSynthesisHead(review.id, { client: prisma });
    expect(first).toMatchObject({ status: "fresh", reasonCodes: [], affectedReferenceCount: 0 });
    expect(repeated.evaluationKey).toBe(first.evaluationKey);
    expect(await prisma.synthesisStalenessEvaluation.count()).toBe(1);
    expect(await prisma.synthesisRegenerationProposal.count()).toBe(0);
    expect({
      runs: await prisma.agentRun.count(),
      drafts: await prisma.synthesisDraft.count(),
      versions: await prisma.reviewVersion.count(),
    }).toEqual(before);
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toMatchObject({
      freshness: { status: "fresh", reasonCodes: [], affectedReferenceCount: 0 },
    });
  });

  it("creates one private policy-drift proposal and resolves it idempotently", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    const draftCount = await prisma.synthesisDraft.count();
    const evaluation = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      materializationPolicyVersion: "synthesis-materialization/2.0.0",
    });
    expect(evaluation).toMatchObject({
      status: "stale",
      reasonCodes: ["materialization-policy-changed"],
    });
    const proposal = (await staleness.listSynthesisRegenerationProposals(prisma))[0]!;
    expect(proposal.reasonCodes).toEqual(["materialization-policy-changed"]);
    const decision = {
      action: "request-regeneration" as const,
      expectedRevision: 0,
      idempotencyKey: "staleness-policy-decision-0001",
      rationale: "The editor requests a new private synthesis draft under the current policy.",
    };
    const resolved = await staleness.decideSynthesisRegenerationProposal(
      actor,
      proposal.id,
      decision,
      prisma,
    );
    expect(
      await staleness.decideSynthesisRegenerationProposal(actor, proposal.id, decision, prisma),
    ).toEqual(resolved);
    expect(resolved).toEqual({ status: "regeneration-requested", revision: 1 });
    await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      materializationPolicyVersion: "synthesis-materialization/2.0.0",
    });
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(0);
    expect(await prisma.synthesisDraft.count()).toBe(draftCount);
  });

  it("deduplicates concurrent node-head drift scans and supersedes the proposal when fresh", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    await prisma.repositorySnapshot.create({
      data: {
        id: "snapshot-stale-v2",
        repositoryId: "repository-v1",
        commitSha: "c".repeat(40),
        inspectionStatus: "succeeded",
        inspectionReportJson: "{}",
        contentHash: "d".repeat(64),
      },
    });
    await prisma.knowledgeNodeVersion.create({
      data: {
        id: "claim-v2",
        knowledgeNodeId: "claim",
        snapshotId: "snapshot-stale-v2",
        title: "A changed grounded claim",
        contributorsJson: '[{"displayName":"Reviewer"}]',
        license: "CC-BY-4.0",
        provenanceJson: canonicalJson({
          sourcePath: "knowledge/claim.json",
          repositoryUrl: "https://github.com/atlas/review",
          commitSha: "c".repeat(40),
        }),
        payloadJson: '{"statement":"A changed grounded claim.","qualifiers":[]}',
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    const results = await Promise.all([
      staleness.evaluateSynthesisHead(review.id, { client: prisma }),
      staleness.evaluateSynthesisHead(review.id, { client: prisma }),
    ]);
    expect(results[0]).toMatchObject({ status: "stale", reasonCodes: ["node-head-changed"] });
    expect(results[1]!.evaluationKey).toBe(results[0]!.evaluationKey);
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(1);
    const openProposal = await prisma.synthesisRegenerationProposal.findFirstOrThrow({
      where: { status: "open" },
      include: { evaluation: true },
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "synthesis.staleness-evaluated",
          subjectId: openProposal.evaluationId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "synthesis.regeneration-proposal.created",
          subjectId: openProposal.id,
        },
      }),
    ).toBe(1);
    await prisma.synthesisStalenessEvaluation.update({
      where: { id: openProposal.evaluationId },
      data: { reasonCodesJson: '["private-or-corrupt-reason"]' },
    });
    expect(await staleness.listSynthesisRegenerationProposals(prisma)).toEqual([]);
    await prisma.synthesisStalenessEvaluation.update({
      where: { id: openProposal.evaluationId },
      data: { reasonCodesJson: openProposal.evaluation.reasonCodesJson },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toMatchObject({
      freshness: { status: "stale", reasonCodes: ["node-head-changed"] },
    });

    await prisma.knowledgeNodeVersion.delete({ where: { id: "claim-v2" } });
    await prisma.repositorySnapshot.delete({ where: { id: "snapshot-stale-v2" } });
    const fresh = await staleness.evaluateSynthesisHead(review.id, { client: prisma });
    expect(fresh.status).toBe("fresh");
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(0);
    expect(
      await prisma.synthesisRegenerationProposal.count({ where: { status: "superseded" } }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "synthesis.regeneration-proposal.superseded",
          subjectId: openProposal.id,
        },
      }),
    ).toBe(1);
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toMatchObject({
      freshness: { status: "fresh", reasonCodes: [] },
    });
  });

  it("reopens a recurring stale A state after A-to-B-to-A without duplicating repeats", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    const policy = "synthesis-materialization/2.0.0";
    const firstA = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      materializationPolicyVersion: policy,
    });
    const firstProposal = (await staleness.listSynthesisRegenerationProposals(prisma))[0]!;
    const sharedKey = "same-key-across-recurring-proposals";
    await staleness.decideSynthesisRegenerationProposal(
      actor,
      firstProposal.id,
      {
        action: "dismiss",
        expectedRevision: 0,
        idempotencyKey: sharedKey,
        rationale: "The editor records the first occurrence before checking the next graph state.",
      },
      prisma,
    );

    await prisma.repositorySnapshot.create({
      data: {
        id: "snapshot-oscillation-v2",
        repositoryId: "repository-v1",
        commitSha: "7".repeat(40),
        inspectionStatus: "succeeded",
        inspectionReportJson: "{}",
        contentHash: "8".repeat(64),
      },
    });
    await prisma.knowledgeNodeVersion.create({
      data: {
        id: "claim-oscillation-v2",
        knowledgeNodeId: "claim",
        snapshotId: "snapshot-oscillation-v2",
        title: "Temporary oscillating evidence",
        contributorsJson: '[{"displayName":"Reviewer"}]',
        license: "CC-BY-4.0",
        provenanceJson: canonicalJson({
          sourcePath: "knowledge/claim.json",
          repositoryUrl: "https://github.com/atlas/review",
          commitSha: "7".repeat(40),
        }),
        payloadJson: '{"statement":"Temporary oscillating evidence.","qualifiers":[]}',
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
      },
    });
    const stateB = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      materializationPolicyVersion: policy,
    });
    const middleProposal = (await staleness.listSynthesisRegenerationProposals(prisma))[0]!;
    expect(stateB.evaluationKey).not.toBe(firstA.evaluationKey);

    await prisma.knowledgeNodeVersion.delete({ where: { id: "claim-oscillation-v2" } });
    await prisma.repositorySnapshot.delete({ where: { id: "snapshot-oscillation-v2" } });
    const recurringA = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      materializationPolicyVersion: policy,
    });
    expect(recurringA.evaluationKey).toBe(firstA.evaluationKey);
    const recurringProposal = (await staleness.listSynthesisRegenerationProposals(prisma))[0]!;
    expect(recurringProposal.id).not.toBe(firstProposal.id);
    expect(recurringProposal.id).not.toBe(middleProposal.id);
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(1);
    expect(
      await prisma.synthesisRegenerationProposal.findUniqueOrThrow({
        where: { id: middleProposal.id },
      }),
    ).toMatchObject({ status: "superseded" });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toMatchObject({
      freshness: { status: "stale", reasonCodes: ["materialization-policy-changed"] },
    });

    const version = await prisma.reviewVersion.findUniqueOrThrow({
      where: { id: review.currentSynthesisVersionId! },
    });
    await prisma.reviewVersion.update({
      where: { id: version.id },
      data: { synthesisProvider: null },
    });
    expect(await staleness.listSynthesisRegenerationProposals(prisma)).toEqual([]);
    await expect(
      staleness.decideSynthesisRegenerationProposal(
        actor,
        recurringProposal.id,
        {
          action: "dismiss",
          expectedRevision: 0,
          idempotencyKey: sharedKey,
          rationale: "The editor dismisses the recurring state after a complete baseline recheck.",
        },
        prisma,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await prisma.reviewVersion.update({
      where: { id: version.id },
      data: { synthesisProvider: version.synthesisProvider },
    });
    await staleness.decideSynthesisRegenerationProposal(
      actor,
      recurringProposal.id,
      {
        action: "dismiss",
        expectedRevision: 0,
        idempotencyKey: sharedKey,
        rationale: "The editor dismisses the recurring state after a complete baseline recheck.",
      },
      prisma,
    );
    expect(
      await prisma.auditEvent.findMany({
        where: { idempotencyKey: { contains: sharedKey } },
        select: { idempotencyKey: true },
      }),
    ).toHaveLength(2);
    expect(
      await prisma.auditEvent.count({
        where: { action: "synthesis.staleness-observed", subjectId: version.id },
      }),
    ).toBeGreaterThanOrEqual(5);
  });

  it("fails closed with a bounded reason when current materialization is invalid", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    await prisma.knowledgeNode.update({ where: { id: "claim" }, data: { kind: "figure" } });
    const failed = await staleness.evaluateSynthesisHead(review.id, { client: prisma });
    expect(failed).toMatchObject({
      status: "stale",
      reasonCodes: ["materialization-failed"],
      affectedReferences: [
        {
          kind: "policy",
          id: "materialization:selection-unavailable",
          change: "changed",
        },
      ],
    });
    const failureEvaluation = await prisma.synthesisStalenessEvaluation.findUniqueOrThrow({
      where: { evaluationKey: failed.evaluationKey },
    });
    expect(failureEvaluation.evaluatedPacketJson).toBeNull();
    expect(failureEvaluation.reasonCodesJson).not.toContain("error");
    await prisma.knowledgeNode.update({ where: { id: "claim" }, data: { kind: "claim" } });
    expect((await staleness.evaluateSynthesisHead(review.id, { client: prisma })).status).toBe(
      "fresh",
    );
  });

  it("fingerprints distinct safe materialization failure classes and deduplicates exact retries", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    const invalid = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      loadPacket: async () => {
        throw new ZodError([]);
      },
    });
    const invalidRepeat = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      loadPacket: async () => {
        throw new ZodError([]);
      },
    });
    expect(invalidRepeat.evaluationKey).toBe(invalid.evaluationKey);
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(1);
    const unavailable = await staleness.evaluateSynthesisHead(review.id, {
      client: prisma,
      loadPacket: async () => {
        throw new service.SynthesisEditorialError("safe-test-failure", "not-found");
      },
    });
    expect(unavailable.evaluationKey).not.toBe(invalid.evaluationKey);
    const stored = await prisma.synthesisStalenessEvaluation.findMany({
      where: { evaluationKey: { in: [invalid.evaluationKey, unavailable.evaluationKey] } },
      orderBy: { failureCode: "asc" },
    });
    expect(stored.map((evaluation) => evaluation.failureCode)).toEqual([
      "invalid-materialization",
      "selection-unavailable",
    ]);
    expect(
      stored.every((evaluation) => /^[0-9a-f]{64}$/.test(evaluation.failureFingerprint!)),
    ).toBe(true);
    expect((await staleness.evaluateSynthesisHead(review.id, { client: prisma })).status).toBe(
      "fresh",
    );
  });

  it("expires a stale bound running run and retries with a new atomic run", async () => {
    let clock = new Date("2026-07-16T13:00:00.000Z");
    let staleRunId = "";
    let providerCalls = 0;
    const input = { selector, requestKey: "generation-bound-run-crash-0001" };
    const provider: LlmProvider = {
      name: "bound-run-recovery",
      model: "recovery-model",
      async complete() {
        providerCalls += 1;
        return canonicalJson(composeDeterministicSynthesis(prepared()));
      },
    };
    await expect(
      service.generateSynthesisDraft(input, {
        client: prisma,
        actor,
        provider,
        now: () => clock,
        leaseDurationMs: 1_000,
        loadPacket: async () => prepared(),
        afterRequestClaimed: async () => {
          await prisma.$transaction(async (tx) => {
            const run = await tx.agentRun.create({
              data: { agentType: "synthesis-review", status: "running" },
            });
            staleRunId = run.id;
            await tx.synthesisGenerationRequestClaim.update({
              where: { requestKey: input.requestKey },
              data: { agentRunId: run.id },
            });
          });
          throw new Error("injected-bound-run-crash");
        },
      }),
    ).rejects.toThrow("injected-bound-run-crash");

    clock = new Date(clock.getTime() + 2_000);
    await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      provider,
      now: () => clock,
      leaseDurationMs: 1_000,
      loadPacket: async () => prepared(),
    });
    expect(providerCalls).toBe(1);
    expect(await prisma.agentRun.findUniqueOrThrow({ where: { id: staleRunId } })).toMatchObject({
      status: "failed",
      error: "lease-expired: Generation owner stopped before completion.",
    });
    expect(await prisma.agentRun.count({ where: { modelProvider: "bound-run-recovery" } })).toBe(1);
  });

  it("retries a recorded failed generation claim", async () => {
    let providerCalls = 0;
    const provider: LlmProvider = {
      name: "failed-run-recovery",
      model: "recovery-model",
      async complete() {
        providerCalls += 1;
        if (providerCalls === 1) throw new Error("provider-unavailable");
        return canonicalJson(composeDeterministicSynthesis(prepared()));
      },
    };
    const input = { selector, requestKey: "generation-failed-retry-0001" };
    await expect(
      service.generateSynthesisDraft(input, {
        client: prisma,
        actor,
        provider,
        loadPacket: async () => prepared(),
      }),
    ).rejects.toThrow("Provider completion failed.");
    expect(
      await prisma.synthesisGenerationRequestClaim.findUniqueOrThrow({
        where: { requestKey: input.requestKey },
      }),
    ).toMatchObject({ status: "failed", attempt: 1 });
    await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      provider,
      loadPacket: async () => prepared(),
    });
    expect(providerCalls).toBe(2);
    expect(
      await prisma.synthesisGenerationRequestClaim.findUniqueOrThrow({
        where: { requestKey: input.requestKey },
      }),
    ).toMatchObject({ status: "completed", attempt: 2 });
  });

  it("resumes a claimed successful run after final-persist interruption without calling the provider twice", async () => {
    let providerCalls = 0;
    let observedAtomicStartBinding = false;
    const provider: LlmProvider = {
      name: "recovery-provider",
      model: "recovery-model",
      async complete() {
        providerCalls += 1;
        const claim = await prisma.synthesisGenerationRequestClaim.findUniqueOrThrow({
          where: { requestKey: "generation-interruption-0001" },
        });
        const running = claim.agentRunId
          ? await prisma.agentRun.findUnique({ where: { id: claim.agentRunId } })
          : null;
        observedAtomicStartBinding = running?.status === "running";
        return canonicalJson(composeDeterministicSynthesis(prepared()));
      },
    };
    const input = { selector, requestKey: "generation-interruption-0001" };
    await expect(
      service.generateSynthesisDraft(input, {
        client: prisma,
        actor,
        provider,
        loadPacket: async () => prepared(),
        afterRunClaimed: async () => {
          throw new Error("injected-final-persist-interruption");
        },
      }),
    ).rejects.toThrow("injected-final-persist-interruption");
    expect(providerCalls).toBe(1);
    expect(observedAtomicStartBinding).toBe(true);
    expect(await prisma.agentRun.count({ where: { modelProvider: "recovery-provider" } })).toBe(1);

    const resumed = await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      provider,
      loadPacket: async () => {
        throw new Error("current graph mutated and must not be rematerialized");
      },
    });
    expect(resumed.status).toBe("pending");
    expect(providerCalls).toBe(1);
    expect(await prisma.agentRun.count({ where: { modelProvider: "recovery-provider" } })).toBe(1);
  });

  it("installs SQLite guards and rejects invalid lifecycle and reference writes", async () => {
    const triggers = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'trigger'
    `;
    expect(triggers.map(({ name }) => name)).toEqual(
      expect.arrayContaining([...SQLITE_DATABASE_GUARD_NAMES]),
    );
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    await expect(
      prisma.review.update({ where: { id: review.id }, data: { synthesisSeriesKey: null } }),
    ).rejects.toThrow();
    const completedClaim = await prisma.synthesisGenerationRequestClaim.findFirstOrThrow({
      where: { status: "completed" },
    });
    await expect(
      prisma.synthesisGenerationRequestClaim.update({
        where: { key: completedClaim.key },
        data: { status: "running" },
      }),
    ).rejects.toThrow();
    const citation = await prisma.synthesisDraftCitation.findFirstOrThrow();
    await expect(
      prisma.synthesisDraftCitation.update({
        where: { id: citation.id },
        data: {
          identifierScheme: "doi",
          identifierRole: "version-doi",
          identifierValue: "10.5281/zenodo.forged",
        },
      }),
    ).rejects.toThrow();
    const evaluation = await prisma.synthesisStalenessEvaluation.findFirstOrThrow();
    await expect(
      prisma.synthesisStalenessEvaluation.update({
        where: { id: evaluation.id },
        data: { status: "invalid" },
      }),
    ).rejects.toThrow();
    const resolvedProposal = await prisma.synthesisRegenerationProposal.findFirstOrThrow({
      where: { status: "regeneration-requested" },
    });
    await expect(
      prisma.synthesisRegenerationProposal.update({
        where: { id: resolvedProposal.id },
        data: { status: "open" },
      }),
    ).rejects.toThrow();
  });

  it("fails public reads closed for corrupt provenance, attribution, hash, and citations", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    const versionId = review.currentSynthesisVersionId!;
    const version = await prisma.reviewVersion.findUniqueOrThrow({ where: { id: versionId } });
    const draft = await prisma.synthesisDraft.findFirstOrThrow({ where: { reviewId: review.id } });
    for (const { data, restore } of [
      {
        data: { synthesisProvider: null },
        restore: { synthesisProvider: version.synthesisProvider },
      },
      { data: { synthesisModel: null }, restore: { synthesisModel: version.synthesisModel } },
      {
        data: { synthesisMaterializationPolicyVersion: null },
        restore: {
          synthesisMaterializationPolicyVersion: version.synthesisMaterializationPolicyVersion,
        },
      },
      {
        data: { synthesisDocumentHash: "f".repeat(64) },
        restore: { synthesisDocumentHash: version.synthesisDocumentHash },
      },
    ]) {
      await prisma.reviewVersion.update({ where: { id: versionId }, data });
      expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
      await expect(
        staleness.evaluateSynthesisHead(review.id, { client: prisma }),
      ).rejects.toMatchObject({ code: "conflict" });
      await prisma.reviewVersion.update({ where: { id: versionId }, data: restore });
    }
    const attribution = await prisma.synthesisAttributionContributor.findFirstOrThrow({
      where: { reviewVersionId: versionId, kind: "approving-editor" },
    });
    await prisma.synthesisAttributionContributor.update({
      where: {
        reviewVersionId_position: { reviewVersionId: versionId, position: attribution.position },
      },
      data: { githubLoginSnapshot: null },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.synthesisAttributionContributor.update({
      where: {
        reviewVersionId_position: { reviewVersionId: versionId, position: attribution.position },
      },
      data: { githubLoginSnapshot: attribution.githubLoginSnapshot },
    });
    const softwareAttribution = await prisma.synthesisAttributionContributor.findFirstOrThrow({
      where: { reviewVersionId: versionId, kind: "software-agent" },
    });
    await prisma.synthesisAttributionContributor.update({
      where: {
        reviewVersionId_position: {
          reviewVersionId: versionId,
          position: softwareAttribution.position,
        },
      },
      data: { userId: actor.id },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.synthesisAttributionContributor.update({
      where: {
        reviewVersionId_position: {
          reviewVersionId: versionId,
          position: softwareAttribution.position,
        },
      },
      data: { userId: null },
    });
    await prisma.synthesisAttributionContributor.create({
      data: {
        reviewVersionId: versionId,
        position: 2,
        kind: "software-agent",
        displayName: "forged",
        role: "synthesis-generation",
      },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.synthesisAttributionContributor.delete({
      where: { reviewVersionId_position: { reviewVersionId: versionId, position: 2 } },
    });
    await prisma.synthesisDraft.update({ where: { id: draft.id }, data: { checklistJson: "{}" } });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.synthesisDraft.update({
      where: { id: draft.id },
      data: { checklistJson: draft.checklistJson },
    });
    await prisma.agentRun.update({
      where: { id: draft.agentRunId },
      data: { humanReviewStatus: "rejected" },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.agentRun.update({
      where: { id: draft.agentRunId },
      data: { humanReviewStatus: "approved" },
    });
    const observation = await prisma.synthesisStalenessHead.findUniqueOrThrow({
      where: { acceptedReviewVersionId: versionId },
      include: { currentEvaluation: true },
    });
    const freshness = observation.currentEvaluation;
    for (const mutation of [
      { reasonCodesJson: '["private-run-id"]' },
      { seriesKey: "f".repeat(64) },
      { acceptedPacketHash: "f".repeat(64) },
      { policyVersion: "synthesis-staleness/forged" },
    ]) {
      await prisma.synthesisStalenessEvaluation.update({
        where: { id: freshness.id },
        data: mutation,
      });
      const failClosedFreshness = await service.getPublicSynthesisReview(review.slug, prisma);
      expect(failClosedFreshness).toMatchObject({ freshness: { status: "unchecked" } });
      expect(JSON.stringify(failClosedFreshness)).not.toContain(freshness.id);
      await prisma.synthesisStalenessEvaluation.update({
        where: { id: freshness.id },
        data: {
          reasonCodesJson: freshness.reasonCodesJson,
          seriesKey: freshness.seriesKey,
          acceptedPacketHash: freshness.acceptedPacketHash,
          policyVersion: freshness.policyVersion,
        },
      });
    }
    const citation = await prisma.synthesisDraftCitation.findFirstOrThrow({
      where: { draftId: draft.id },
    });
    await prisma.synthesisDraftCitation.update({
      where: { id: citation.id },
      data: { nodeTitle: "tampered" },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.synthesisDraftCitation.update({
      where: { id: citation.id },
      data: { nodeTitle: citation.nodeTitle },
    });
    await prisma.$executeRawUnsafe('DROP TRIGGER "SynthesisDraftCitation_guard_update"');
    await prisma.synthesisDraftCitation.update({
      where: { id: citation.id },
      data: {
        identifierScheme: "doi",
        identifierRole: "version-doi",
        identifierValue: "10.5281/zenodo.forged",
      },
    });
    expect(await service.getPublicSynthesisReview(review.slug, prisma)).toBeNull();
    await prisma.synthesisDraftCitation.update({
      where: { id: citation.id },
      data: { identifierScheme: null, identifierRole: null, identifierValue: null },
    });
    await applyDatabaseGuards(prisma, "sqlite");
  });

  it("keeps rejection private and resolves concurrent decisions with one CAS winner", async () => {
    const rejectSelector = {
      ...selector,
      selection: { kind: "seed" as const, nodeId: "claim-reject" },
    };
    const rejectedDraft = await service.generateSynthesisDraft(
      { selector: rejectSelector, requestKey: "generation-request-0002" },
      { client: prisma, actor, loadPacket: async () => prepared("claim-reject") },
    );
    const versionCount = await prisma.reviewVersion.count({
      where: { recordSourceType: "synthesis" },
    });
    await service.decideSynthesisDraft(
      rejectedDraft.id,
      {
        action: "reject",
        expectedRevision: 0,
        idempotencyKey: "reject-request-0002",
        rationale:
          "The synthesis framing requires substantive editorial revision before publication.",
      },
      actor,
      prisma,
    );
    expect(await prisma.reviewVersion.count({ where: { recordSourceType: "synthesis" } })).toBe(
      versionCount,
    );
    expect(
      await prisma.review.findUnique({
        where: { synthesisSeriesKey: service.synthesisSeriesKey(rejectSelector) },
      }),
    ).toBeNull();
    expect(
      (
        await prisma.agentRun.findUniqueOrThrow({
          where: {
            id: (await prisma.synthesisDraft.findUniqueOrThrow({ where: { id: rejectedDraft.id } }))
              .agentRunId,
          },
        })
      ).humanReviewStatus,
    ).toBe("rejected");

    const racedDraft = await service.generateSynthesisDraft(
      { selector, requestKey: "generation-request-0003" },
      { client: prisma, actor, loadPacket: async () => prepared() },
    );
    const outcomes = await Promise.allSettled([
      service.decideSynthesisDraft(
        racedDraft.id,
        { ...acceptance, idempotencyKey: "race-accept-0003" },
        actor,
        prisma,
      ),
      service.decideSynthesisDraft(
        racedDraft.id,
        {
          action: "reject",
          expectedRevision: 0,
          idempotencyKey: "race-reject-0003",
          rationale: "A concurrent editor found the synthesis unsuitable for publication.",
        },
        actor,
        prisma,
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });

  it("atomically supersedes an obsolete open proposal when a newer head is accepted", async () => {
    const review = await prisma.review.findFirstOrThrow({ where: { reviewType: "ai-synthesis" } });
    await prisma.repositorySnapshot.create({
      data: {
        id: "snapshot-supersession-v2",
        repositoryId: "repository-v1",
        commitSha: "e".repeat(40),
        inspectionStatus: "succeeded",
        inspectionReportJson: "{}",
        contentHash: "f".repeat(64),
      },
    });
    await prisma.knowledgeNodeVersion.create({
      data: {
        id: "claim-supersession-v2",
        knowledgeNodeId: "claim",
        snapshotId: "snapshot-supersession-v2",
        title: "New evidence before a synthesis acceptance",
        contributorsJson: '[{"displayName":"Reviewer"}]',
        license: "CC-BY-4.0",
        provenanceJson: canonicalJson({
          sourcePath: "knowledge/claim.json",
          repositoryUrl: "https://github.com/atlas/review",
          commitSha: "e".repeat(40),
        }),
        payloadJson: '{"statement":"New evidence.","qualifiers":[]}',
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    await staleness.evaluateSynthesisHead(review.id, { client: prisma });
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(1);
    const obsoleteProposal = await prisma.synthesisRegenerationProposal.findFirstOrThrow({
      where: { status: "open" },
    });
    const nextDraft = await service.generateSynthesisDraft(
      { selector, requestKey: "generation-supersession-0001" },
      { client: prisma, actor, loadPacket: async () => prepared() },
    );
    await service.decideSynthesisDraft(
      nextDraft.id,
      { ...acceptance, idempotencyKey: "accept-supersession-0001" },
      actor,
      prisma,
    );
    expect(await prisma.synthesisRegenerationProposal.count({ where: { status: "open" } })).toBe(0);
    expect(
      await prisma.synthesisRegenerationProposal.count({ where: { status: "superseded" } }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          action: "synthesis.regeneration-proposal.superseded",
          subjectId: obsoleteProposal.id,
        },
      }),
    ).toMatchObject({ actorId: actor.id });
    await prisma.knowledgeNodeVersion.delete({ where: { id: "claim-supersession-v2" } });
    await prisma.repositorySnapshot.delete({ where: { id: "snapshot-supersession-v2" } });
  });

  it("continues a paged scan after one corrupt head and audits the bounded failure", async () => {
    const secondSelector = {
      ...selector,
      selection: { kind: "seed" as const, nodeId: "claim-reject" },
    };
    const draft = await service.generateSynthesisDraft(
      { selector: secondSelector, requestKey: "generation-scan-isolation-0001" },
      { client: prisma, actor, loadPacket: async () => prepared("claim-reject") },
    );
    await service.decideSynthesisDraft(
      draft.id,
      {
        ...acceptance,
        idempotencyKey: "accept-scan-isolation-0001",
        versionDoi: "10.5281/zenodo.2234567",
        conceptDoi: "10.5281/zenodo.2234500",
      },
      actor,
      prisma,
    );
    const corruptReview = await prisma.review.findUniqueOrThrow({
      where: { synthesisSeriesKey: service.synthesisSeriesKey(selector) },
      include: { currentSynthesisVersion: true },
    });
    await prisma.reviewVersion.update({
      where: { id: corruptReview.currentSynthesisVersionId! },
      data: { synthesisProvider: null },
    });
    const scan = await staleness.scanAcceptedSyntheses({ client: prisma, actor, limit: 100 });
    expect(scan).toMatchObject({ scanned: 2, succeeded: 1, failed: 1 });
    expect(scan.failures).toEqual([{ code: "evaluation-failed", reviewSlug: corruptReview.slug }]);
    expect(
      await prisma.auditEvent.findFirst({
        where: { action: "synthesis.staleness-scan-failed", subjectId: corruptReview.id },
      }),
    ).toMatchObject({ actorId: actor.id });
    await prisma.reviewVersion.update({
      where: { id: corruptReview.currentSynthesisVersionId! },
      data: { synthesisProvider: corruptReview.currentSynthesisVersion!.synthesisProvider },
    });
  });
});
