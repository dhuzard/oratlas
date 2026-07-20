import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { archiveSearchQuerySchema, canonicalJson, type NodeArchiveQuery } from "@oratlas/contracts";
import { type PrismaClient } from "@oratlas/db";
import type * as NodePublication from "./node-publication";
import type * as ArchiveSearch from "./archive-search";
import type * as EdgeLifecycle from "./node-edge-lifecycle";

vi.mock("server-only", () => ({}));

const databasePath = resolve(
  process.cwd(),
  "packages/db/prisma",
  `.tmp-oratlas-node-pages-${process.pid}-${Date.now()}.db`,
);
const databaseUrl = `file:./${databasePath.split(/[\\/]/).at(-1)}`;

let prisma: PrismaClient;
let nodes: typeof NodePublication;
let archive: typeof ArchiveSearch;
let edgeLifecycle: typeof EdgeLifecycle;
let claimNodeId: string;
let datasetNodeId: string;
let oldClaimVersionId: string;
let confirmedDatasetVersionId: string;
let currentDatasetVersionId: string;
let malformedDatasetVersionId: string;
let corruptOldVersionId: string;
let malformedRelatedEdgeId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  const require = createRequire(import.meta.url);
  const prismaPackage = require.resolve("prisma/package.json", {
    paths: [resolve(process.cwd(), "packages/db")],
  });
  execFileSync(
    process.execPath,
    [
      resolve(dirname(prismaPackage), "build/index.js"),
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

  ({ prisma } = await import("./db"));
  nodes = await import("./node-publication");
  archive = await import("./archive-search");
  edgeLifecycle = await import("./node-edge-lifecycle");

  const repository = await prisma.repository.create({
    data: {
      owner: "node-lab",
      name: "publications",
      canonicalUrl: "https://github.com/node-lab/publications",
    },
  });
  const editor = await prisma.user.create({
    data: { githubUserId: "node-page-editor", githubLogin: "node-page-editor", role: "EDITOR" },
  });
  const reader = await prisma.user.create({
    data: { githubUserId: "node-page-reader", githubLogin: "node-page-reader", role: "USER" },
  });
  const oldSnapshot = await snapshot(repository.id, "a", new Date("2025-01-01T00:00:00Z"));
  const currentSnapshot = await snapshot(repository.id, "b", new Date("2026-01-01T00:00:00Z"));
  const newerSnapshot = await snapshot(repository.id, "c", new Date("2026-02-01T00:00:00Z"));
  const review = await prisma.review.create({
    data: {
      repositoryId: repository.id,
      currentSnapshotId: currentSnapshot.id,
      slug: "beta-review",
      title: "Beta review",
      status: "published",
      acceptedAt: new Date("2026-01-02T00:00:00Z"),
    },
  });
  const reviewVersion = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: currentSnapshot.id,
      title: "Beta review",
      metadataJson: canonicalJson({ keywords: [], domains: [] }),
      publicState: "published",
      publishedAt: new Date("2026-01-02T00:00:00Z"),
      createdAt: new Date("2026-01-02T00:00:00Z"),
    },
  });
  for (const [snapshotId, title, createdAt] of [
    [oldSnapshot.id, "Beta review history", new Date("2025-01-02T00:00:00Z")],
    [newerSnapshot.id, "Beta review update", new Date("2026-02-02T00:00:00Z")],
  ] as const) {
    await prisma.reviewVersion.create({
      data: {
        reviewId: review.id,
        snapshotId,
        title,
        metadataJson: canonicalJson({ keywords: [], domains: [] }),
        publicState: "published",
        publishedAt: createdAt,
        createdAt,
      },
    });
  }

  const claim = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId: "claim-alpha", kind: "claim" },
  });
  claimNodeId = claim.id;
  const oldClaim = await createVersion(claim.id, oldSnapshot.id, {
    title: "Alpha claim (old)",
    kind: "claim",
    payload: { statement: "The earlier statement.", qualifiers: [] },
    createdAt: new Date("2025-01-02T00:00:00Z"),
  });
  oldClaimVersionId = oldClaim.id;
  const currentClaim = await createVersion(claim.id, currentSnapshot.id, {
    title: "Alpha claim",
    kind: "claim",
    payload: { statement: "The current statement.", qualifiers: ["Bounded scope."] },
    createdAt: new Date("2026-01-03T00:00:00Z"),
  });

  const dataset = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId: "dataset-delta", kind: "dataset" },
  });
  datasetNodeId = dataset.id;
  const confirmedDatasetVersion = await createVersion(dataset.id, currentSnapshot.id, {
    title: "Delta dataset",
    kind: "dataset",
    payload: {
      artifactPath: "data/delta.csv",
      format: "text/csv",
      sizeBytes: 2048,
      doi: "10.1234/delta.artifact",
    },
    versionDoi: "10.1234/delta.v1",
    conceptDoi: "10.5555/delta.example-concept",
    isExample: true,
    createdAt: new Date("2026-01-04T00:00:00Z"),
  });
  confirmedDatasetVersionId = confirmedDatasetVersion.id;
  const currentDatasetVersion = await createVersion(dataset.id, newerSnapshot.id, {
    title: "Delta dataset v2",
    kind: "dataset",
    payload: {
      artifactPath: "data/delta-v2.csv",
      format: "text/csv",
      sizeBytes: 4096,
      doi: "10.1234/delta.artifact",
    },
    versionDoi: "10.1234/delta.v1",
    conceptDoi: "10.5555/delta.example-concept",
    isExample: true,
    createdAt: new Date("2026-02-02T00:00:00Z"),
  });
  currentDatasetVersionId = currentDatasetVersion.id;
  const malformedDatasetVersion = await prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: dataset.id,
      snapshotId: oldSnapshot.id,
      title: "Malformed dataset history",
      contributorsJson: canonicalJson([]),
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({ sourcePath: "nodes/dataset-malformed.json" }),
      payloadJson: canonicalJson({ format: "text/csv", injected: true }),
      createdAt: new Date("2025-01-03T00:00:00Z"),
    },
  });
  malformedDatasetVersionId = malformedDatasetVersion.id;

  const code = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId: "code-gamma", kind: "code" },
  });
  const codeVersion = await createVersion(code.id, currentSnapshot.id, {
    title: "Gamma code",
    kind: "code",
    payload: { entryPoints: ["src/main.py"], language: "Python", releaseRef: "v1" },
    createdAt: new Date("2026-01-05T00:00:00Z"),
  });

  const figure = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId: "figure-epsilon", kind: "figure" },
  });
  const figureVersion = await createVersion(figure.id, currentSnapshot.id, {
    title: "Epsilon figure",
    kind: "figure",
    payload: {
      artifactPath: "figures/effect.svg",
      caption: "An escaped <script> caption.",
      altText: "Two intervals.",
    },
    createdAt: new Date("2026-01-06T00:00:00Z"),
  });

  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: currentClaim.id,
      targetNodeId: dataset.id,
      relationType: "uses-dataset",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: confirmedDatasetVersion.id,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-01-10T00:00:00Z"),
    },
  });
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: codeVersion.id,
      targetNodeId: dataset.id,
      relationType: "uses-dataset",
      status: "proposed",
      provenance: "proposed-by-agent",
    },
  });
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: figureVersion.id,
      targetNodeId: claim.id,
      relationType: "derives-from",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: currentClaim.id,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-01-10T00:00:00Z"),
    },
  });
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: codeVersion.id,
      targetNodeId: claim.id,
      relationType: "contradicts",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: currentClaim.id,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-01-11T00:00:00Z"),
    },
  });
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: figureVersion.id,
      targetNodeId: claim.id,
      relationType: "contradicts",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: oldClaim.id,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-01-12T00:00:00Z"),
    },
  });
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: currentClaim.id,
      targetNodeId: code.id,
      relationType: "uses-code",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: codeVersion.id,
      confirmedById: reader.id,
      confirmedAt: new Date("2026-01-13T00:00:00Z"),
    },
  });
  await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: currentClaim.id,
      targetNodeId: figure.id,
      relationType: "derives-from",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: codeVersion.id,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-01-14T00:00:00Z"),
    },
  });
  const malformedRelatedEdge = await prisma.nodeEdge.create({
    data: {
      sourceNodeVersionId: oldClaim.id,
      targetNodeId: dataset.id,
      relationType: "uses-dataset",
      status: "confirmed",
      provenance: "confirmed-by-editor",
      confirmedTargetNodeVersionId: malformedDatasetVersion.id,
      confirmedById: editor.id,
      confirmedAt: new Date("2026-01-15T00:00:00Z"),
    },
  });
  malformedRelatedEdgeId = malformedRelatedEdge.id;

  const linkedClaim = await prisma.claim.create({
    data: {
      reviewVersionId: reviewVersion.id,
      knowledgeNodeId: claim.id,
      localClaimId: "claim-alpha",
      text: "The current statement.",
      normalizedText: "the current statement",
    },
  });
  const citation = await prisma.citation.create({
    data: {
      reviewVersionId: reviewVersion.id,
      localCitationId: "citation-1",
      doi: "10.1234/evidence",
      title: "Evidence work",
      rawCitationJson: canonicalJson({ isExample: false }),
    },
  });
  const relation = await prisma.claimEvidenceRelation.create({
    data: {
      claimId: linkedClaim.id,
      citationId: citation.id,
      relationType: "supports",
    },
  });
  await prisma.trustAssessment.create({
    data: {
      claimEvidenceRelationId: relation.id,
      protocolVersion: "trust-poc-1.0",
      assessorType: "agent",
      reviewStatus: "agent-proposed",
      aggregateScore: 0.75,
      aggregateMethod: "ordinal-mean-1.0",
    },
  });

  for (const input of [
    {
      localCitationId: "citation-reserved-missing-raw",
      doi: "10.5555/example-without-raw",
      rawCitationJson: null,
    },
    {
      localCitationId: "citation-reserved-malformed-raw",
      doi: "10.5555/example-with-malformed-raw",
      rawCitationJson: "{not-json",
    },
  ]) {
    const reservedCitation = await prisma.citation.create({
      data: {
        reviewVersionId: reviewVersion.id,
        ...input,
        title: input.localCitationId,
      },
    });
    await prisma.claimEvidenceRelation.create({
      data: {
        claimId: linkedClaim.id,
        citationId: reservedCitation.id,
        relationType: "mentions",
      },
    });
  }

  const corrupt = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId: "corrupt", kind: "claim" },
  });
  const corruptOld = await createVersion(corrupt.id, oldSnapshot.id, {
    title: "Previously valid claim",
    kind: "claim",
    payload: { statement: "An older valid statement.", qualifiers: [] },
    createdAt: new Date("2025-01-04T00:00:00Z"),
  });
  corruptOldVersionId = corruptOld.id;
  await prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: corrupt.id,
      snapshotId: currentSnapshot.id,
      title: "Corrupt payload",
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({ sourcePath: "nodes/corrupt.json" }),
      payloadJson: canonicalJson({ statement: "x", injected: true }),
      createdAt: new Date("2026-01-07T00:00:00Z"),
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (existsSync(databasePath)) rmSync(databasePath, { force: true });
}, 30_000);

describe("public node query layer", () => {
  it("uses stable dynamic ids, selects current/history, confirmed edges, and relation TRUST", async () => {
    const current = await nodes.getPublicNode(claimNodeId);
    expect(current?.version.title).toBe("Alpha claim");
    expect(current?.edges.map((edge) => `${edge.direction}:${edge.relationType}`)).toEqual([
      "incoming:contradicts",
      "outgoing:uses-dataset",
    ]);
    const datasetEdge = current?.edges.find((edge) => edge.relationType === "uses-dataset");
    expect(datasetEdge?.relatedNode).toMatchObject({
      id: datasetNodeId,
      title: "Delta dataset",
      versionId: confirmedDatasetVersionId,
    });
    expect(datasetEdge?.relatedNode.versionId).not.toBe(currentDatasetVersionId);
    expect(current?.trustContext).toHaveLength(3);
    expect(
      current?.trustContext.find((context) => context.citationLocalId === "citation-1"),
    ).toMatchObject({
      relationType: "supports",
      trust: { reviewStatus: "unverified-import", aggregateMethod: "ordinal-mean-1.0" },
    });

    const historical = await nodes.getPublicNode(claimNodeId, oldClaimVersionId);
    expect(historical?.version.title).toBe("Alpha claim (old)");
    expect(historical?.version.id).toBe(oldClaimVersionId);
    expect(historical?.edges.map((edge) => `${edge.direction}:${edge.relationType}`)).toEqual([
      "incoming:contradicts",
    ]);
    expect(historical?.trustContext).toEqual([]);
  });

  it("suppresses reserved citation DOI links without relying on raw citation JSON", async () => {
    const current = await nodes.getPublicNode(claimNodeId);
    const reserved = current?.trustContext.filter((context) =>
      context.citationDoi?.startsWith("10.5555/"),
    );
    expect(reserved).toHaveLength(2);
    expect(reserved?.map((context) => context.citationIsExample)).toEqual([true, true]);
  });

  it("keeps DOI roles distinct and marks only 10.5555 identifiers as examples", async () => {
    const dataset = await nodes.getPublicNode(datasetNodeId);
    expect(dataset?.version.id).toBe(currentDatasetVersionId);
    expect(dataset?.version.identifiers).toEqual([
      {
        scheme: "doi",
        role: "version-doi",
        value: "10.1234/delta.v1",
        isExample: false,
      },
      {
        scheme: "doi",
        role: "concept-doi",
        value: "10.5555/delta.example-concept",
        isExample: true,
      },
      {
        scheme: "doi",
        role: "artifact-doi",
        value: "10.1234/delta.artifact",
        isExample: false,
      },
    ]);
    expect(dataset?.edges).toEqual([]);
  });

  it("filters list results before paginating and withholds a node whose newest version is corrupt", async () => {
    const query: NodeArchiveQuery = { q: "dataset", kind: "dataset", page: 1, pageSize: 1 };
    const result = await nodes.listPublicNodes(query);
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(datasetNodeId);

    const corrupt = await prisma.knowledgeNode.findFirstOrThrow({
      where: { localNodeId: "corrupt" },
    });
    const allNodes = await nodes.listPublicNodes({ page: 1, pageSize: 50 });
    expect(allNodes.total).toBe(4);
    expect(allNodes.items.some((node) => node.id === corrupt.id)).toBe(false);
    const archiveNodes = await archive.searchArchive(
      archiveSearchQuerySchema.parse({ contentType: "node", page: 1, pageSize: 50 }),
    );
    expect(archiveNodes.total).toBe(4);
    expect(
      archiveNodes.items.some((item) => item.contentType === "node" && item.node.id === corrupt.id),
    ).toBe(false);
    expect(await nodes.getPublicNode(corrupt.id)).toBeNull();
    expect(await nodes.getPublicNode(corrupt.id, corruptOldVersionId)).toBeNull();
  });

  it("omits malformed history and related versions without leaking their summaries", async () => {
    const dataset = await nodes.getPublicNode(datasetNodeId);
    expect(dataset?.versions.map((version) => version.id)).not.toContain(malformedDatasetVersionId);

    const historicalClaim = await nodes.getPublicNode(claimNodeId, oldClaimVersionId);
    expect(historicalClaim?.edges.map((edge) => edge.relatedNode.versionId)).not.toContain(
      malformedDatasetVersionId,
    );
    expect(historicalClaim?.edges.map((edge) => edge.relationType)).toEqual(["contradicts"]);
    expect(
      (await edgeLifecycle.listConfirmedEdgesForNode(claimNodeId)).map((edge) => edge.id),
    ).not.toContain(malformedRelatedEdgeId);
  });

  it("allows accepted node-only versions but makes review-backed versions obey tombstones", async () => {
    const repository = await prisma.repository.findFirstOrThrow({ where: { owner: "node-lab" } });
    const hiddenSnapshot = await snapshot(repository.id, "f", new Date("2026-03-01T00:00:00Z"));
    const hiddenNode = await prisma.knowledgeNode.create({
      data: { repositoryId: repository.id, localNodeId: "claim-visibility-guard", kind: "claim" },
    });
    const hiddenVersion = await createVersion(hiddenNode.id, hiddenSnapshot.id, {
      title: "Visibility guard claim",
      kind: "claim",
      payload: { statement: "This content requires publication authority.", qualifiers: [] },
      createdAt: new Date("2026-03-02T00:00:00Z"),
    });
    const exactKey = `${hiddenNode.id}\u0000${hiddenVersion.id}`;
    const assertHidden = async () => {
      expect(await nodes.getPublicNode(hiddenNode.id)).toBeNull();
      expect(await nodes.getPublicNode(hiddenNode.id, hiddenVersion.id)).toBeNull();
      expect(
        (await nodes.listPublicNodes({ q: "visibility guard", page: 1, pageSize: 10 })).items,
      ).toEqual([]);
      expect(
        (
          await nodes.getExactPublicNodeVersions([
            { nodeId: hiddenNode.id, nodeVersionId: hiddenVersion.id },
          ])
        ).has(exactKey),
      ).toBe(false);
    };

    await assertHidden();

    const submitter = await prisma.user.findFirstOrThrow({
      where: { githubLogin: "node-page-reader" },
    });
    const nodeOnlySubmission = await prisma.submission.create({
      data: {
        submitterId: submitter.id,
        repositoryId: repository.id,
        snapshotId: hiddenSnapshot.id,
        status: "accepted",
        acceptedNodeSelectionJson: canonicalJson([hiddenNode.localNodeId]),
      },
    });
    await prisma.knowledgeNodeVersion.update({
      where: { id: hiddenVersion.id },
      data: { sourceSubmissionId: nodeOnlySubmission.id },
    });
    expect((await nodes.getPublicNode(hiddenNode.id))?.version.id).toBe(hiddenVersion.id);
    expect(
      (
        await nodes.getExactPublicNodeVersions([
          { nodeId: hiddenNode.id, nodeVersionId: hiddenVersion.id },
        ])
      ).has(exactKey),
    ).toBe(true);

    const tombstonedReview = await prisma.review.create({
      data: { slug: "visibility-tombstoned", title: "Tombstoned authority", status: "published" },
    });
    const tombstonedVersion = await prisma.reviewVersion.create({
      data: {
        reviewId: tombstonedReview.id,
        snapshotId: hiddenSnapshot.id,
        title: "Tombstoned authority",
        metadataJson: "{}",
        publicState: "tombstoned",
      },
    });
    await prisma.submission.update({
      where: { id: nodeOnlySubmission.id },
      data: { resultingReviewVersionId: tombstonedVersion.id },
    });
    await assertHidden();

    const readableReview = await prisma.review.create({
      data: { slug: "visibility-readable", title: "Readable authority", status: "published" },
    });
    const readableVersion = await prisma.reviewVersion.create({
      data: {
        reviewId: readableReview.id,
        snapshotId: hiddenSnapshot.id,
        title: "Readable authority",
        metadataJson: "{}",
        publicState: "published",
      },
    });
    expect((await nodes.getPublicNode(hiddenNode.id))?.version.id).toBe(hiddenVersion.id);
    expect(
      (await nodes.listPublicNodes({ q: "visibility guard", page: 1, pageSize: 10 })).items.map(
        (item) => item.id,
      ),
    ).toEqual([hiddenNode.id]);
    expect(
      (
        await nodes.getExactPublicNodeVersions([
          { nodeId: hiddenNode.id, nodeVersionId: hiddenVersion.id },
        ])
      ).has(exactKey),
    ).toBe(true);

    await prisma.reviewVersion.update({
      where: { id: readableVersion.id },
      data: { publicState: "withdrawn" },
    });
    expect((await nodes.getPublicNode(hiddenNode.id))?.version.id).toBe(hiddenVersion.id);

    await prisma.reviewVersion.update({
      where: { id: readableVersion.id },
      data: { publicState: "tombstoned" },
    });
    await assertHidden();
  });
});

describe("combined archive search", () => {
  it("merges review and node records before one deterministic pagination slice", async () => {
    const first = await archive.searchArchive(
      archiveSearchQuerySchema.parse({ sort: "title", page: 1, pageSize: 2 }),
    );
    const second = await archive.searchArchive(
      archiveSearchQuerySchema.parse({ sort: "title", page: 2, pageSize: 2 }),
    );
    expect(first.total).toBe(5);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    const keys = [...first.items, ...second.items].map((item) =>
      item.contentType === "review"
        ? `review:${item.slug}`
        : item.contentType === "synthesis"
          ? `synthesis:${item.slug}`
          : `node:${item.node.id}`,
    );
    expect(new Set(keys).size).toBe(4);
  });

  it("supports content-type and node-kind filters", async () => {
    const result = await archive.searchArchive(
      archiveSearchQuerySchema.parse({
        contentType: "node",
        nodeKind: "dataset",
        page: 1,
        pageSize: 20,
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      contentType: "node",
      node: { id: datasetNodeId, kind: "dataset" },
    });
  });
});

async function snapshot(repositoryId: string, char: string, capturedAt: Date) {
  return prisma.repositorySnapshot.create({
    data: {
      repositoryId,
      commitSha: char.repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: char.repeat(64),
      capturedAt,
    },
  });
}

async function createVersion(
  knowledgeNodeId: string,
  snapshotId: string,
  input: {
    title: string;
    kind: "claim" | "figure" | "dataset" | "code";
    payload: unknown;
    versionDoi?: string;
    conceptDoi?: string;
    isExample?: boolean;
    createdAt: Date;
  },
) {
  return prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId,
      snapshotId,
      title: input.title,
      contributorsJson: canonicalJson([]),
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({
        sourcePath: `nodes/${input.kind}.json`,
        repositoryUrl: "https://github.com/node-lab/publications",
      }),
      payloadJson: canonicalJson(input.payload),
      versionDoi: input.versionDoi,
      conceptDoi: input.conceptDoi,
      isExample: input.isExample ?? false,
      createdAt: input.createdAt,
    },
  });
}
