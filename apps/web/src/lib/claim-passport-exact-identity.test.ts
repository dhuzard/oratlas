import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findClaim: vi.fn(), getNode: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({
  prisma: { claim: { findFirst: mocks.findClaim, findMany: vi.fn().mockResolvedValue([]) } },
  parseJsonColumn: (_value: unknown, fallback: unknown) => fallback,
}));
vi.mock("./node-publication", () => ({ getPublicNode: mocks.getNode }));
vi.mock("./execution-passports", () => ({
  listExecutionPassportsForClaim: vi.fn().mockResolvedValue([]),
}));
vi.mock("./protocol-drift", () => ({
  getPublicProtocolSummary: vi.fn().mockResolvedValue({ snapshots: [] }),
}));

import { getClaimPassport } from "./claim-monitoring";

function claimFixture() {
  return {
    localClaimId: "claim-one",
    text: "Historical claim",
    normalizedText: "historical claim",
    knowledgeNodeId: "node-one",
    graphVersion: { id: "exact-old-node-version", knowledgeNodeId: "node-one" },
    reviewVersion: {
      id: "old-review-version",
      title: "Old review",
      publicState: "published",
      metadataJson: "{}",
      snapshot: null,
      review: { slug: "review", status: "published", versions: [] },
    },
    evidenceRelations: [],
    updateProposals: [],
  };
}

describe("claim passport exact graph binding", () => {
  beforeEach(() => {
    mocks.findClaim.mockReset().mockResolvedValue(claimFixture());
    mocks.getNode.mockReset().mockImplementation(async (_nodeId: string, versionId?: string) => ({
      id: "node-one",
      kind: "claim",
      version: { id: versionId ?? "newer-node-version", title: "Claim" },
      sameClaims: [],
    }));
  });

  it("uses the bound historical node version, never the current-node default", async () => {
    const passport = await getClaimPassport("old-review-version", "claim-one");
    expect(mocks.getNode).toHaveBeenCalledWith("node-one", "exact-old-node-version");
    expect(passport?.graphIdentity?.nodeVersionId).toBe("exact-old-node-version");
    expect(passport?.links.graph).toContain("version=exact-old-node-version");
    expect(passport?.links.graph).not.toContain("newer-node-version");
  });

  it("does not substitute the current node when the occurrence lacks an owned exact binding", async () => {
    mocks.findClaim.mockResolvedValue({ ...claimFixture(), graphVersion: null });
    expect(
      (await getClaimPassport("old-review-version", "claim-one"))?.graphIdentity,
    ).toBeUndefined();
    expect(mocks.getNode).not.toHaveBeenCalled();
    mocks.findClaim.mockResolvedValue({
      ...claimFixture(),
      graphVersion: { id: "foreign-version", knowledgeNodeId: "other-node" },
    });
    expect(
      (await getClaimPassport("old-review-version", "claim-one"))?.graphIdentity,
    ).toBeUndefined();
    expect(mocks.getNode).not.toHaveBeenCalled();
  });
});
