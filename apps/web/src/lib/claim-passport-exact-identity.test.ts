import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findClaim: vi.fn(),
  getNode: vi.fn(),
  findLegacyVersion: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({
  prisma: {
    claim: { findFirst: mocks.findClaim, findMany: vi.fn().mockResolvedValue([]) },
    knowledgeNodeVersion: { findFirst: mocks.findLegacyVersion },
  },
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
    mocks.findLegacyVersion.mockReset().mockResolvedValue(null);
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

  it("preserves seeded legacy transitions through the exact repository snapshot, not the current node", async () => {
    const claim = claimFixture();
    const legacyClaim = {
      ...claim,
      localClaimId: "claim-adversarial-instruction",
      graphVersion: null,
      reviewVersion: {
        ...claim.reviewVersion,
        recordSourceType: "repository",
        snapshotId: "historical-source-snapshot",
        review: { ...claim.reviewVersion.review, repositoryId: "source-repository" },
      },
    };
    mocks.findClaim.mockResolvedValue(legacyClaim);
    mocks.findLegacyVersion.mockResolvedValue({ id: "historical-repository-node-version" });
    const passport = await getClaimPassport("old-review-version", "claim-adversarial-instruction");
    expect(mocks.findLegacyVersion).toHaveBeenCalledWith({
      where: {
        knowledgeNodeId: "node-one",
        snapshotId: "historical-source-snapshot",
        sourceClaimId: null,
        knowledgeNode: {
          originType: "repository-object",
          kind: "claim",
          repositoryId: "source-repository",
        },
      },
      select: { id: true },
    });
    expect(mocks.getNode).toHaveBeenCalledWith("node-one", "historical-repository-node-version");
    expect(passport?.links.graph).toContain("version=historical-repository-node-version");
    expect(passport?.links.graph).not.toContain("newer-node-version");

    // Canonical backfill also binds a snapshot-free sourceClaim projection. The
    // human repository view must still use the exact source snapshot, not latest.
    mocks.findClaim.mockResolvedValue({
      ...legacyClaim,
      graphVersion: {
        id: "canonical-claim-projection",
        knowledgeNodeId: "node-one",
        snapshotId: null,
      },
    });
    expect(
      (await getClaimPassport("old-review-version", "claim-adversarial-instruction"))?.links.graph,
    ).toContain("version=historical-repository-node-version");

    mocks.getNode.mockClear();
    mocks.findLegacyVersion.mockResolvedValue(null);
    expect(
      (await getClaimPassport("old-review-version", "claim-adversarial-instruction"))
        ?.graphIdentity,
    ).toBeUndefined();
    expect(mocks.getNode).not.toHaveBeenCalled();
  });

  it("does not use the legacy path to repair a conflicting occurrence binding", async () => {
    const claim = claimFixture();
    mocks.findClaim.mockResolvedValue({
      ...claim,
      graphVersion: { id: "foreign-version", knowledgeNodeId: "other-node" },
      reviewVersion: {
        ...claim.reviewVersion,
        recordSourceType: "repository",
        snapshotId: "historical-source-snapshot",
        review: { ...claim.reviewVersion.review, repositoryId: "source-repository" },
      },
    });
    expect(
      (await getClaimPassport("old-review-version", "claim-one"))?.graphIdentity,
    ).toBeUndefined();
    expect(mocks.findLegacyVersion).not.toHaveBeenCalled();
    expect(mocks.getNode).not.toHaveBeenCalled();
  });
});
