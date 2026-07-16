import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";
import type { SessionUser } from "./auth";
import type * as Editorial from "./synthesis-editorial";
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
  service = await import("./synthesis-editorial");
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
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: "{}",
      payloadJson: '{"statement":"A grounded claim.","qualifiers":[]}',
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
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: "{}",
      payloadJson: '{"statement":"A grounded claim.","qualifiers":[]}',
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
      version: { ordinal: 1, isCurrent: true },
    });
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

  it("resumes a claimed successful run after final-persist interruption without calling the provider twice", async () => {
    let providerCalls = 0;
    const provider: LlmProvider = {
      name: "recovery-provider",
      model: "recovery-model",
      async complete() {
        providerCalls += 1;
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
    expect(await prisma.agentRun.count({ where: { modelProvider: "recovery-provider" } })).toBe(1);

    const resumed = await service.generateSynthesisDraft(input, {
      client: prisma,
      actor,
      provider,
      loadPacket: async () => prepared(),
    });
    expect(resumed.status).toBe("pending");
    expect(providerCalls).toBe(1);
    expect(await prisma.agentRun.count({ where: { modelProvider: "recovery-provider" } })).toBe(1);
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
});
