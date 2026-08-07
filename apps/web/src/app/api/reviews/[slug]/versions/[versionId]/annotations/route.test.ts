import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comments", () => ({ listReviewComments: state.list }));

import { GET } from "./route";

const params = {
  params: Promise.resolve({ slug: "review-one", versionId: "version-1" }),
};

describe("GET version annotations", () => {
  beforeEach(() => {
    state.list.mockReset().mockResolvedValue({
      reviewSlug: "review-one",
      reviewVersionId: "version-1",
      commentCount: 0,
      comments: [],
    });
  });

  it("serves an interoperable JSON-LD AnnotationPage", async () => {
    const response = await GET(
      new Request("https://oratlas.test/api/reviews/review-one/versions/version-1/annotations"),
      params,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/ld+json");
    expect(response.headers.get("link")).toContain("http://www.w3.org/ns/anno.jsonld");
    await expect(response.json()).resolves.toMatchObject({
      type: "AnnotationPage",
      partOf: "https://oratlas.test/reviews/review-one/versions/version-1",
      items: [],
    });
  });

  it("returns not found for a non-public version", async () => {
    state.list.mockResolvedValue(null);
    const response = await GET(
      new Request("https://oratlas.test/api/reviews/review-one/versions/version-1/annotations"),
      params,
    );
    expect(response.status).toBe(404);
  });
});
