import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ getReviewDetail: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/reviews", () => ({ getReviewDetail: state.getReviewDetail }));

import { GET as getCurrentReview } from "./route";
import { GET as getExactReview } from "./versions/[versionId]/route";

const review = {
  slug: "example",
  version: { id: "v2" },
  versions: [
    { id: "v2", isCurrent: true, publicState: "published" },
    { id: "v1", isCurrent: false, publicState: "withdrawn" },
  ],
  lifecycleEvents: [{ kind: "correction", reviewVersionId: "v2", supersedesVersionId: "v1" }],
};

describe("review API Link headers", () => {
  beforeEach(() => {
    state.getReviewDetail.mockReset().mockResolvedValue(review);
  });

  it("links the current API representation to its human and version-history resources", async () => {
    const response = await getCurrentReview(
      new Request("https://atlas.example/api/reviews/example"),
      {
        params: Promise.resolve({ slug: "example" }),
      },
    );

    expect(response.status).toBe(200);
    const links = response.headers.get("link");
    expect(links).toContain('</openapi.yaml>; rel="service-desc"');
    expect(links).toContain('</reviews/example>; rel="alternate"; type="text/html"');
    expect(links).toContain('</reviews/example>; rel="latest-version"; type="text/html"');
    expect(links).toContain(
      '</reviews/example#record-details>; rel="version-history"; type="text/html"',
    );
    expect(links).toContain(
      '</reviews/example/versions/v1>; rel="predecessor-version"; type="text/html"',
    );
  });

  it("links an exact API representation using its exact human URL", async () => {
    const response = await getExactReview(
      new Request("https://atlas.example/api/reviews/example/versions/v2"),
      { params: Promise.resolve({ slug: "example", versionId: "v2" }) },
    );

    expect(state.getReviewDetail).toHaveBeenCalledWith("example", "v2");
    expect(response.headers.get("link")).toContain(
      '</reviews/example/versions/v2>; rel="alternate"; type="text/html"',
    );
  });
});
