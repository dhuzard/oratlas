import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicNodeSummary } from "@oratlas/contracts";

const mocks = vi.hoisted(() => ({
  listPublicNodeSummaries: vi.fn(),
  findSynthesisCandidates: vi.fn(),
  getPublicSynthesisReview: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));
vi.mock("./node-publication", () => ({
  PUBLIC_NODE_SEARCH_LIMIT: 2_000,
  listPublicNodeSummaries: mocks.listPublicNodeSummaries,
}));
vi.mock("./synthesis-editorial", () => ({
  getPublicSynthesisReview: mocks.getPublicSynthesisReview,
}));

import { buildTopicCoverageSnapshot, getTopicCoverage } from "./synthesis-coverage";

function node(
  id: string,
  versionId: string,
  kind: PublicNodeSummary["kind"] = "claim",
  repository = "lab-a",
): PublicNodeSummary {
  return {
    id,
    localNodeId: id,
    kind,
    title: `${id} title`,
    repository: { owner: repository, name: "nodes", url: `https://github.com/${repository}/nodes` },
    currentVersionId: versionId,
    updatedAt: "2026-07-17T10:00:00.000Z",
  };
}

function candidate(
  slug: string,
  versionId: string,
  memberships: Array<{ nodeId: string; nodeVersionId: string }>,
  latestVersionId = versionId,
) {
  return {
    slug,
    currentSynthesisVersionId: versionId,
    currentSynthesisVersion: {
      id: versionId,
      synthesisDraft: { status: "accepted", memberships },
    },
    versions: [{ id: latestVersionId }],
  };
}

describe("topic coverage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listPublicNodeSummaries.mockResolvedValue([]);
    mocks.findSynthesisCandidates.mockResolvedValue([]);
  });

  it("uses exact current node-version membership and deterministic topic groups", () => {
    const nodes = [
      node("zeta", "zeta-v2", "dataset", "lab-b"),
      node("alpha", "alpha-v1", "claim", "lab-a"),
      node("beta", "beta-v1", "claim", "lab-a"),
    ];
    const result = buildTopicCoverageSnapshot(nodes, new Set(["zeta\0zeta-v1", "beta\0beta-v1"]));
    expect(result.coveredNodeCount).toBe(1);
    expect(result.groups.map((group) => group.label)).toEqual([
      "Claims · lab-a/nodes",
      "Datasets · lab-b/nodes",
    ]);
    expect(result.groups[0]?.nodes.map((entry) => entry.id)).toEqual(["alpha"]);
    expect(result.groups[1]?.nodes.map((entry) => entry.currentVersionId)).toEqual(["zeta-v2"]);
    expect(JSON.stringify(result)).not.toMatch(/draft|membership|synthesisSlug/i);
  });

  it("counts only valid latest accepted synthesis heads", async () => {
    const client = { review: { findMany: mocks.findSynthesisCandidates } } as never;
    mocks.listPublicNodeSummaries.mockResolvedValue([
      node("covered", "covered-v1"),
      node("historical", "historical-v1"),
      node("private", "private-v1"),
    ]);
    mocks.findSynthesisCandidates.mockResolvedValue([
      candidate("valid", "synthesis-v1", [{ nodeId: "covered", nodeVersionId: "covered-v1" }]),
      candidate(
        "historical-head",
        "historical-synthesis-v1",
        [{ nodeId: "historical", nodeVersionId: "historical-v1" }],
        "historical-synthesis-v2",
      ),
      candidate("private-or-corrupt", "private-synthesis-v1", [
        { nodeId: "private", nodeVersionId: "private-v1" },
      ]),
    ]);
    mocks.getPublicSynthesisReview.mockImplementation(async (slug: string) =>
      slug === "private-or-corrupt"
        ? null
        : { version: { id: slug === "valid" ? "synthesis-v1" : "historical-synthesis-v1" } },
    );

    const result = await getTopicCoverage(client);
    expect(result.coveredNodeCount).toBe(1);
    expect(result.groups.flatMap((group) => group.nodes.map((entry) => entry.id))).toEqual([
      "historical",
      "private",
    ]);
  });

  it("enforces node and synthesis request ceilings", async () => {
    const client = { review: { findMany: mocks.findSynthesisCandidates } } as never;
    mocks.listPublicNodeSummaries.mockResolvedValue(
      Array.from({ length: 2_001 }, (_, index) => node(`node-${index}`, `version-${index}`)),
    );
    mocks.findSynthesisCandidates.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        candidate(`synthesis-${index}`, `synthesis-version-${index}`, []),
      ),
    );
    mocks.getPublicSynthesisReview.mockImplementation(async (slug: string) => ({
      version: { id: `synthesis-version-${slug.split("-").at(-1)}` },
    }));

    const result = await getTopicCoverage(client);
    expect(result.scannedNodeCount).toBe(2_000);
    expect(result.bounds).toMatchObject({
      nodeLimit: 2_000,
      nodeLimitReached: true,
      synthesisCandidateLimit: 500,
      synthesisCandidateLimitReached: true,
    });
    expect(mocks.getPublicSynthesisReview).toHaveBeenCalledTimes(500);
    expect(mocks.findSynthesisCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });
});
