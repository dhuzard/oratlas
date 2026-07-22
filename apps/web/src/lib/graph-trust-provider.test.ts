import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, projectAssessments } = vi.hoisted(() => ({
  findMany: vi.fn(),
  projectAssessments: vi.fn((rows: Array<{ id: string }>) =>
    rows.map((row) => ({
      assessmentId: row.id,
      protocolVersion: "TRUST-1.0",
      assessorType: "human",
      assessorId: "reviewer-1",
      assessedAt: "2026-01-01T00:00:00.000Z",
      conflictOfInterest: { status: "not-provided" },
      reviewStatus: "human-reviewed",
      verificationState: "platform-verified",
    })),
  ),
}));

vi.mock("server-only", () => ({}));
vi.mock("./db.js", () => ({
  prisma: { nodeRelationTrustAssessment: { findMany } },
}));
vi.mock("./trust-provenance.js", () => ({
  loadedNodeRelationTrustInclude: { proposal: true },
  projectPublicNodeRelationTrustAssessments: projectAssessments,
}));

import { databaseGraphTrustProvider } from "./graph-trust-provider.js";
import { graphTrustLookupKey } from "./graph-trust.js";

const exactKey = {
  sourceVersionId: "source-version",
  targetVersionId: "target-version",
  relationType: "supports" as const,
};

function minimalRow(index: number, relationType = "supports") {
  return {
    id: `assessment-${index}`,
    proposal: {
      sourceNodeVersionId: "source-version",
      targetNodeVersionId: "target-version",
      relationType,
    },
  };
}

describe("databaseGraphTrustProvider", () => {
  beforeEach(() => {
    findMany.mockReset();
    projectAssessments.mockClear();
  });

  it("does not query persistence when no exact relation keys are requested", async () => {
    await expect(databaseGraphTrustProvider.lookup([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it("uses one complete exact-key query without a silent global row cap", async () => {
    findMany.mockResolvedValue([]);

    await expect(databaseGraphTrustProvider.lookup([exactKey, exactKey])).resolves.toEqual(
      new Map(),
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              proposal: {
                sourceNodeVersionId: "source-version",
                targetNodeVersionId: "target-version",
                relationType: "supports",
              },
            },
          ],
        },
      }),
    );
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
  });

  it("retains complete assessment sets above 50 and never falls back to another relation", async () => {
    findMany.mockResolvedValue([
      ...Array.from({ length: 51 }, (_, index) => minimalRow(index)),
      minimalRow(52, "contradicts"),
    ]);

    const result = await databaseGraphTrustProvider.lookup([exactKey]);
    expect(result.get(graphTrustLookupKey(exactKey))).toHaveLength(51);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("retains full provenance metadata for a singleton assessment", async () => {
    findMany.mockResolvedValue([minimalRow(1)]);

    const result = await databaseGraphTrustProvider.lookup([exactKey]);
    expect(result.get(graphTrustLookupKey(exactKey))).toMatchObject({
      assessmentId: "assessment-1",
      protocolVersion: "TRUST-1.0",
      assessorType: "human",
      assessorId: "reviewer-1",
      assessedAt: "2026-01-01T00:00:00.000Z",
      conflictOfInterest: { status: "not-provided" },
    });
  });
});
