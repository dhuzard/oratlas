import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@oratlas/db";
import type { SynthesisSelector } from "@oratlas/contracts";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));

import { loadPreparedSynthesisPacket } from "./synthesis-editorial";

const selector: SynthesisSelector = {
  schemaVersion: "synthesis-selector/1.0.0",
  selection: { kind: "seed", nodeId: "claim-node" },
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

describe("synthesis graph selection", () => {
  it("selects the newest public repository occurrence instead of a newer relational occurrence", async () => {
    const findNodes = vi.fn().mockResolvedValue([
      {
        id: "claim-node",
        repositoryId: "repository",
        stableKey: null,
        originType: null,
        localNodeId: "claim",
        kind: "claim",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        repository: {
          owner: "atlas",
          name: "review",
          canonicalUrl: "https://github.com/atlas/review",
        },
        versions: [
          {
            id: "repository-version",
            knowledgeNodeId: "claim-node",
            snapshotId: "snapshot",
            sourceSubmissionId: null,
            sourceReviewVersionId: null,
            sourceClaimId: null,
            sourceCitationId: null,
            title: "Repository claim",
            abstract: null,
            text: "A repository-backed claim.",
            contributorsJson: '[{"displayName":"Reviewer"}]',
            license: "CC-BY-4.0",
            provenanceJson:
              '{"sourcePath":"knowledge/claim.json","repositoryUrl":"https://github.com/atlas/review","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
            payloadJson: '{"statement":"A repository-backed claim.","qualifiers":[]}',
            versionDoi: null,
            conceptDoi: null,
            isExample: false,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            snapshot: { commitSha: "a".repeat(40) },
          },
        ],
      },
    ]);
    const client = {
      knowledgeNode: { findMany: findNodes },
      nodeEdge: { findMany: vi.fn().mockResolvedValue([]) },
      nodeRelationTrustAssessment: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const prepared = await loadPreparedSynthesisPacket(selector, client);

    expect(prepared.packet.nodes).toEqual([
      expect.objectContaining({ id: "claim-node", versionId: "repository-version" }),
    ]);
    expect(findNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          versions: expect.objectContaining({ where: { OR: expect.any(Array) } }),
        }),
      }),
    );
  });
});
