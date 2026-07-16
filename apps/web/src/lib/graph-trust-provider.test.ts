import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./db.js", () => ({
  prisma: { nodeRelationTrustAssessment: { findMany } },
}));

import { databaseGraphTrustProvider } from "./graph-trust-provider.js";

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

describe("databaseGraphTrustProvider bounds", () => {
  beforeEach(() => findMany.mockReset());

  it("does not query persistence when no exact relation keys are requested", async () => {
    await expect(databaseGraphTrustProvider.lookup([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it("uses one globally bounded exact-key query and fails closed above 10,000 rows", async () => {
    findMany.mockResolvedValue(Array.from({ length: 10_001 }, () => null));

    await expect(databaseGraphTrustProvider.lookup([exactKey, exactKey])).resolves.toEqual(
      new Map(),
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10_001,
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
  });

  it("omits an exact key above 50 assessments and never falls back to another relation", async () => {
    findMany.mockResolvedValue([
      ...Array.from({ length: 51 }, (_, index) => minimalRow(index)),
      minimalRow(52, "contradicts"),
    ]);

    await expect(databaseGraphTrustProvider.lookup([exactKey])).resolves.toEqual(new Map());
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
