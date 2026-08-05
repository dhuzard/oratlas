import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeLandscapeResponse } from "@oratlas/contracts";

const mocks = vi.hoisted(() => ({
  agentRunCreate: vi.fn(),
  nodeVersionFindUnique: vi.fn(),
  createKnowledgeLandscapeResponse: vi.fn(),
  createAgentNodeEdgeProposal: vi.fn(),
  createOpenAIProvider: vi.fn(),
  createAnthropicProvider: vi.fn(),
  proposeGraphCuration: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({
  prisma: {
    agentRun: { create: mocks.agentRunCreate },
    knowledgeNodeVersion: { findUnique: mocks.nodeVersionFindUnique },
  },
}));
vi.mock("./knowledge-landscape-service", () => ({
  createKnowledgeLandscapeResponse: mocks.createKnowledgeLandscapeResponse,
}));
vi.mock("./node-edge-lifecycle", () => ({
  createAgentNodeEdgeProposal: mocks.createAgentNodeEdgeProposal,
}));
vi.mock("@oratlas/knowledge", () => ({
  canonicalJson: (value: unknown) => JSON.stringify(value),
  createOpenAIProvider: mocks.createOpenAIProvider,
  createAnthropicProvider: mocks.createAnthropicProvider,
  proposeGraphCuration: mocks.proposeGraphCuration,
}));

import { buildGraphCurationPacket, runGraphCuration } from "./graph-curation-ai";

const landscape: KnowledgeLandscapeResponse = {
  schemaVersion: "2.0.0",
  algorithm: {
    id: "explicit-interest-graph-landscape",
    version: "2.0.0",
    purpose: "navigation",
    limitations: [
      "not-a-truth-score",
      "not-a-quality-score",
      "canonical-source-assertion-and-confirmed-edges",
      "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
    ],
  },
  query: { interests: [] },
  landscape: {
    nodes: [
      {
        id: "review:r1",
        kind: "review",
        label: "Review",
        detail: "Review detail",
        href: "/reviews/r1",
        reasons: ["selected review"],
      },
      {
        id: "claim:a",
        kind: "claim",
        label: "Claim A",
        detail: "Claim detail",
        href: "/claims/a",
        reasons: ["selected claim"],
        graphNodeId: "node-a",
        graphNodeVersionId: "version-a",
      },
      {
        id: "evidence:work",
        kind: "evidence",
        label: "Evidence",
        detail: "Evidence detail",
        href: "/claims/a#linked-evidence",
        reasons: ["linked evidence"],
        graphNodeId: "ignored-evidence",
        graphNodeVersionId: "ignored-evidence-version",
      },
      {
        id: "graph:b",
        kind: "code",
        label: "Code B",
        detail: "Code detail",
        href: "/nodes/b",
        reasons: ["confirmed graph neighbor"],
        graphNodeId: "node-b",
        graphNodeVersionId: "version-b",
      },
    ],
    edges: [
      {
        graphEdgeId: "edge-uses-code",
        sourceId: "claim:a",
        targetId: "graph:b",
        label: "uses code",
        relationType: "uses-code",
        status: "confirmed",
      },
      {
        graphEdgeId: "edge-supports",
        sourceId: "claim:a",
        targetId: "evidence:work",
        label: "supports",
        relationType: "supports",
      },
    ],
    matchedClaimCount: 1,
    shownClaimCount: 1,
    graphSeedCount: 1,
    graphNodeCount: 2,
    timeline: [],
  },
};

describe("graph curation web orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters non-graph nodes and maps only confirmed edges into the packet", () => {
    expect(buildGraphCurationPacket("Which relation is missing?", landscape)).toEqual({
      schemaVersion: "1.0.0",
      question: "Which relation is missing?",
      nodes: [
        {
          landscapeNodeId: "claim:a",
          nodeId: "node-a",
          nodeVersionId: "version-a",
          kind: "claim",
          title: "Claim A",
        },
        {
          landscapeNodeId: "graph:b",
          nodeId: "node-b",
          nodeVersionId: "version-b",
          kind: "code",
          title: "Code B",
        },
      ],
      confirmedEdges: [
        {
          sourceNodeVersionId: "version-a",
          targetNodeVersionId: "version-b",
          relationType: "uses-code",
        },
      ],
    });
  });

  it("creates a review proposal without persisting the request-scoped API key", async () => {
    const apiKey = "sk-review-only-secret-not-for-storage";
    const provider = { name: "openai", model: "test-model", complete: vi.fn() };
    mocks.createKnowledgeLandscapeResponse.mockResolvedValue(landscape);
    mocks.createOpenAIProvider.mockReturnValue(provider);
    mocks.proposeGraphCuration.mockResolvedValue({
      provider: "openai",
      model: "test-model",
      modelVersion: "test-version",
      promptVersion: "atlas-graph-curation-1.0",
      attempts: 1,
      output: {
        schemaVersion: "1.0.0",
        proposals: [
          {
            sourceNodeVersionId: "version-a",
            targetNodeVersionId: "version-b",
            relationType: "supports",
            rationale: "The bounded source nodes justify editorial review of this relation.",
            evidenceNodeIds: ["claim:a", "graph:b"],
          },
        ],
      },
    });
    mocks.nodeVersionFindUnique
      .mockResolvedValueOnce(nodeVersion("source-repository", "claim:a", "a".repeat(40)))
      .mockResolvedValueOnce(nodeVersion("target-repository", "code:b", "b".repeat(40)));
    mocks.agentRunCreate.mockResolvedValue({ id: "run-1" });
    mocks.createAgentNodeEdgeProposal.mockResolvedValue({
      proposalId: "proposal-1",
      idempotent: false,
    });

    const result = await runGraphCuration(
      "Which relation is missing?",
      { interests: [] },
      { provider: "openai", apiKey, model: "test-model" },
    );

    expect(mocks.createOpenAIProvider).toHaveBeenCalledWith({ apiKey, model: "test-model" });
    expect(mocks.createKnowledgeLandscapeResponse).toHaveBeenCalledWith({ interests: [] });
    expect(result.created).toEqual([{ proposalId: "proposal-1", idempotent: false }]);
    expect(JSON.stringify(mocks.agentRunCreate.mock.calls)).not.toContain(apiKey);
    expect(JSON.stringify(mocks.createAgentNodeEdgeProposal.mock.calls)).not.toContain(apiKey);
    expect(mocks.agentRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentType: "node-edge-proposal",
        modelProvider: "openai",
        status: "succeeded",
      }),
    });
    expect(mocks.createAgentNodeEdgeProposal).toHaveBeenCalledWith(
      expect.objectContaining({ agentRunId: "run-1", relationType: "supports" }),
    );
  });
});

function nodeVersion(repositoryId: string, localNodeId: string, commitSha: string) {
  return {
    knowledgeNode: {
      localNodeId,
      repository: { githubRepositoryId: repositoryId },
    },
    snapshot: { commitSha },
  };
}
