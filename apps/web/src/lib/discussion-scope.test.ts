import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildEvidencePacket: vi.fn(),
  findNodeVersions: vi.fn(),
  findDiscussableOccurrence: vi.fn(),
  findEdges: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@oratlas/config", () => ({
  getServerEnv: () => ({ sessionSecret: "discussion-scope-test-secret" }),
}));
vi.mock("@oratlas/knowledge", () => ({
  buildEvidencePacket: mocks.buildEvidencePacket,
}));
vi.mock("./db", () => ({
  prisma: {
    knowledgeNodeVersion: {
      findMany: mocks.findNodeVersions,
      findFirst: mocks.findDiscussableOccurrence,
    },
    nodeEdge: { findMany: mocks.findEdges },
  },
}));
vi.mock("./knowledge-landscape-service", () => ({
  canonicalLandscapeNodeId: (nodeId: string, nodeVersionId: string) =>
    `graph:${nodeId}:${nodeVersionId}`,
}));

import {
  hasDiscussableCanonicalClaimOccurrence,
  issueDiscussionTraversalScope,
  selectDiscussionEvidence,
  verifyDiscussionTraversalScope,
} from "./discussion-scope";

describe("exact Atlas Discuss traversal scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gates Discuss on a resolvable exact claim occurrence", async () => {
    mocks.findDiscussableOccurrence.mockResolvedValueOnce({ id: "claim-version" });
    await expect(
      hasDiscussableCanonicalClaimOccurrence([
        { nodeId: "claim-node", nodeVersionId: "claim-version" },
      ]),
    ).resolves.toBe(true);
    expect(mocks.findDiscussableOccurrence).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sourceClaimId: { not: null },
        OR: [{ id: "claim-version", knowledgeNodeId: "claim-node" }],
      }),
      select: { id: true },
    });

    mocks.findDiscussableOccurrence.mockResolvedValueOnce(null);
    await expect(
      hasDiscussableCanonicalClaimOccurrence([
        { nodeId: "native-node", nodeVersionId: "native-version" },
      ]),
    ).resolves.toBe(false);
  });

  it("rejects an empty traversal before signing or selecting archive evidence", () => {
    expect(() => issueDiscussionTraversalScope({ nodes: [], edges: [] })).toThrow(
      "nonempty traversed graph scope",
    );
    expect(mocks.findNodeVersions).not.toHaveBeenCalled();
    expect(mocks.buildEvidencePacket).not.toHaveBeenCalled();
  });

  it("fails closed when a client edits a signed node or edge set", async () => {
    const issued = issueDiscussionTraversalScope({
      nodes: [{ nodeId: "claim-node", nodeVersionId: "claim-version" }],
      edges: [],
    });
    const tampered = {
      ...issued,
      nodes: [{ nodeId: "another-node", nodeVersionId: "claim-version" }],
    };

    expect(() => verifyDiscussionTraversalScope(tampered)).toThrow("invalid or was modified");
    await expect(selectDiscussionEvidence({} as never, "Question?", tampered)).rejects.toThrow(
      "invalid or was modified",
    );
    expect(mocks.findNodeVersions).not.toHaveBeenCalled();
    expect(mocks.buildEvidencePacket).not.toHaveBeenCalled();
  });

  it("uses only exact persisted occurrences and signed visible claim-citation edges", async () => {
    const issued = issueDiscussionTraversalScope({
      nodes: [
        { nodeId: "node-work", nodeVersionId: "version-work" },
        { nodeId: "node-claim", nodeVersionId: "version-claim" },
      ],
      edges: [{ graphEdgeId: "edge-claim-work" }],
    });
    mocks.findNodeVersions.mockResolvedValue([
      {
        id: "version-claim",
        knowledgeNodeId: "node-claim",
        sourceClaimId: "database-claim-row-1",
        sourceCitationId: null,
      },
      {
        id: "version-work",
        knowledgeNodeId: "node-work",
        sourceClaimId: null,
        sourceCitationId: "database-citation-row-1",
      },
    ]);
    mocks.findEdges.mockResolvedValue([
      {
        id: "edge-claim-work",
        sourceNodeVersionId: "version-claim",
        targetNodeId: "node-work",
        confirmedTargetNodeVersionId: "version-work",
        relationType: "supports",
      },
    ]);
    mocks.buildEvidencePacket.mockReturnValue({ claims: [{ claimId: "global-claim-1" }] });

    const result = await selectDiscussionEvidence(
      {
        claims: [
          {
            graphNodeVersionId: "version-claim",
            claimId: "global-claim-1",
            relations: [
              { citationId: "global-citation-1", relationType: "supports" },
              { citationId: "not-selected", relationType: "contradicts" },
            ],
          },
          {
            graphNodeVersionId: "another-claim-version",
            claimId: "global-claim-2",
            relations: [],
          },
        ],
        citations: [
          {
            graphNodeVersionId: "version-work",
            citationId: "global-citation-1",
          },
        ],
      } as never,
      "What is known?",
      issued,
    );

    expect(mocks.buildEvidencePacket).toHaveBeenCalledWith(
      expect.objectContaining({
        claims: [
          expect.objectContaining({
            claimId: "global-claim-1",
            relations: [{ citationId: "global-citation-1", relationType: "supports" }],
          }),
        ],
        citations: [expect.objectContaining({ citationId: "global-citation-1" })],
      }),
      "",
      { claimIds: ["global-claim-1"], maxClaims: 1 },
    );
    expect(result.scope).toMatchObject({
      kind: "explore",
      claimIds: ["global-claim-1"],
      landscapeNodeIds: ["graph:node-claim:version-claim", "graph:node-work:version-work"],
      landscapeNodeVersionIds: ["version-claim", "version-work"],
      landscapeEdgeIds: ["edge-claim-work"],
      claimLandscapeNodeIds: {
        "global-claim-1": "graph:node-claim:version-claim",
      },
      citationLandscapeNodeIds: {
        "global-citation-1": "graph:node-work:version-work",
      },
    });
  });

  it("rejects a signed scope whose occurrence has become stale or private", async () => {
    const issued = issueDiscussionTraversalScope({
      nodes: [{ nodeId: "node-claim", nodeVersionId: "stale-version" }],
      edges: [],
    });
    mocks.findNodeVersions.mockResolvedValue([]);

    await expect(selectDiscussionEvidence({} as never, "Question?", issued)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(mocks.findEdges).not.toHaveBeenCalled();
    expect(mocks.buildEvidencePacket).not.toHaveBeenCalled();
  });

  it("rejects an edge that does not connect two exact visible occurrences", async () => {
    const issued = issueDiscussionTraversalScope({
      nodes: [{ nodeId: "node-claim", nodeVersionId: "version-claim" }],
      edges: [{ graphEdgeId: "edge-to-hidden-work" }],
    });
    mocks.findNodeVersions.mockResolvedValue([
      {
        id: "version-claim",
        knowledgeNodeId: "node-claim",
        sourceClaimId: "claim-row",
        sourceCitationId: null,
      },
    ]);
    mocks.findEdges.mockResolvedValue([
      {
        id: "edge-to-hidden-work",
        sourceNodeVersionId: "version-claim",
        targetNodeId: "hidden-work",
        confirmedTargetNodeVersionId: "hidden-work-version",
        relationType: "supports",
      },
    ]);

    await expect(selectDiscussionEvidence({} as never, "Question?", issued)).rejects.toThrow(
      "does not connect the exact visible occurrences",
    );
    expect(mocks.buildEvidencePacket).not.toHaveBeenCalled();
  });
});
