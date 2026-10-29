import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { PrismaClient } from "../generated/client/index.js";

/** Shared provider contract: content type never substitutes for source identity. */
export async function assertReviewSourceUnion(prisma: PrismaClient): Promise<void> {
  const suffix = randomUUID();
  const repository = await prisma.repository.create({
    data: { owner: "guard", name: suffix, canonicalUrl: `https://github.com/guard/${suffix}` },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha: "a".repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "b".repeat(64),
    },
  });
  const imported = await prisma.review.create({
    data: {
      slug: `imported-${suffix}`,
      title: "Source-owned AI synthesis",
      reviewType: "ai-synthesis",
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
    },
  });
  expect(imported.reviewType).toBe("ai-synthesis");
  expect(imported.synthesisSeriesKey).toBeNull();
  const internal = await prisma.review.create({
    data: {
      slug: `internal-${suffix}`,
      title: "Internal synthesis",
      reviewType: "ai-synthesis",
      synthesisSeriesKey: `series-${suffix}`,
    },
  });
  expect(internal.repositoryId).toBeNull();
  for (const data of [
    { repositoryId: null },
    { currentSnapshotId: null },
    { synthesisSeriesKey: `mixed-${suffix}` },
    { currentSynthesisVersionId: "invented-head" },
  ]) {
    await expect(prisma.review.update({ where: { id: imported.id }, data })).rejects.toThrow();
  }
  for (const data of [
    { repositoryId: repository.id },
    { currentSnapshotId: snapshot.id },
    { reviewType: "systematic" },
    { reviewType: null },
  ]) {
    await expect(prisma.review.update({ where: { id: internal.id }, data })).rejects.toThrow();
  }
  await expect(
    prisma.review.create({
      data: { slug: `unbound-${suffix}`, title: "No source", reviewType: "ai-synthesis" },
    }),
  ).rejects.toThrow();
  // Leave the provider fixture empty for the canonical-contract finalization checks that follow.
  await prisma.review.deleteMany({ where: { id: { in: [imported.id, internal.id] } } });
  await prisma.repositorySnapshot.delete({ where: { id: snapshot.id } });
  await prisma.repository.delete({ where: { id: repository.id } });
}
