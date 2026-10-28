import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: { submission: { findFirst: mocks.find } } }));
import { getOwnedSubmissionStatus } from "./submission-status";

function row(publicState = "published", reviewStatus = "published") {
  return {
    id: "submission",
    status: "accepted",
    submittedAt: new Date("2026-10-28T00:00:00Z"),
    sourceKind: "release",
    releaseTag: "v1",
    snapshot: { commitSha: "a".repeat(40) },
    resultingReviewVersion: {
      id: "exact-version",
      publicState,
      review: { slug: "source", status: reviewStatus },
    },
    editorialNote: "PRIVATE EDITORIAL NOTE",
    inspectionToken: "SECRET CAPABILITY",
  };
}
describe("owner-only submission status projection", () => {
  beforeEach(() => mocks.find.mockReset());
  it("queries exact ownership and emits only allowlisted status fields", async () => {
    mocks.find.mockResolvedValue(row());
    const status = await getOwnedSubmissionStatus("submission", "owner");
    expect(mocks.find.mock.calls[0]?.[0].where).toEqual({ id: "submission", submitterId: "owner" });
    expect(status?.publicReviewHref).toBe("/reviews/source/versions/exact-version");
    expect(JSON.stringify(status)).not.toContain("PRIVATE");
    expect(JSON.stringify(status)).not.toContain("SECRET");
    expect(Object.keys(mocks.find.mock.calls[0]?.[0].select)).not.toContain("editorialNote");
  });
  it("treats absent and other-owner submissions identically", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await getOwnedSubmissionStatus("submission", "other-owner")).toBeNull();
    expect(await getOwnedSubmissionStatus("missing", "owner")).toBeNull();
  });
  it("links withdrawn public versions but withholds tombstoned and unpublished targets", async () => {
    mocks.find.mockResolvedValue(row("withdrawn"));
    expect((await getOwnedSubmissionStatus("submission", "owner"))?.publicReviewHref).toContain(
      "exact-version",
    );
    for (const candidate of [row("tombstoned"), row("unknown-state"), row("published", "draft")]) {
      mocks.find.mockResolvedValue(candidate);
      expect(
        (await getOwnedSubmissionStatus("submission", "owner"))?.publicReviewHref,
      ).toBeUndefined();
    }
  });
});
