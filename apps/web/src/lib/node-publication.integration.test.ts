import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { archiveSearchQuerySchema, canonicalJson, type NodeArchiveQuery } from "@oratlas/contracts";
import { type PrismaClient } from "@oratlas/db";
import type * as NodePublication from "./node-publication";
import type * as ArchiveSearch from "./archive-search";

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
let claimNodeId: string;
let datasetNodeId: string;
let oldClaimVersionId: string;

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

  const repository = await prisma.repository.create({
    data: {
      owner: "node-lab",
      name: "publications",
      canonicalUrl: "https://github.com/node-lab/publications",
    },
  });
  const oldSnapshot = await snapshot(repository.id, "a", new Date("2025-01-01T00:00:00Z"));
  const currentSnapshot = await snapshot(repository.id, "b", new Date("2026-01-01T00:00:00Z"));
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
  await createVersion(dataset.id, currentSnapshot.id, {
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
    },
  });

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
    expect(current?.edges.map((edge) => edge.relationType)).toEqual([
      "derives-from",
      "uses-dataset",
    ]);
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
    expect(dataset?.edges).toHaveLength(1);
    expect(dataset?.edges[0]?.provenance).toBe("confirmed-by-editor");
  });

  it("filters list results before paginating and fails closed on malformed stored payload", async () => {
    const query: NodeArchiveQuery = { q: "dataset", kind: "dataset", page: 1, pageSize: 1 };
    const result = await nodes.listPublicNodes(query);
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(datasetNodeId);

    const corrupt = await prisma.knowledgeNode.findFirstOrThrow({
      where: { localNodeId: "corrupt" },
    });
    await expect(nodes.getPublicNode(corrupt.id)).rejects.toThrow();
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
    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    const keys = [...first.items, ...second.items].map((item) =>
      item.contentType === "review" ? `review:${item.slug}` : `node:${item.node.id}`,
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
