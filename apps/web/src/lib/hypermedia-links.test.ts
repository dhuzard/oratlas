import { describe, expect, it } from "vitest";
import { addNextPageLink, addReviewHypermediaLinks } from "./hypermedia-links";

function relationTarget(header: string | null, relation: string): string | undefined {
  return header
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => value.includes(`rel="${relation}"`))
    ?.match(/^<([^>]+)>/)?.[1];
}

describe("review hypermedia links", () => {
  it("uses correction lifecycle relations rather than version-array adjacency", () => {
    const response = addReviewHypermediaLinks(
      new Response(null, { headers: { Link: '</openapi.yaml>; rel="service-desc"' } }),
      {
        slug: "review example",
        version: { id: "v2" },
        versions: [
          { id: "unrelated", isCurrent: false, publicState: "published" },
          { id: "v1", isCurrent: false, publicState: "withdrawn" },
          { id: "v3", isCurrent: true, publicState: "published" },
          { id: "v2", isCurrent: false, publicState: "published" },
        ],
        lifecycleEvents: [
          {
            kind: "correction",
            reviewVersionId: "v2",
            supersedesVersionId: "v1",
          },
          {
            kind: "correction",
            reviewVersionId: "v3",
            supersedesVersionId: "v2",
          },
        ],
      },
      true,
    );

    const header = response.headers.get("link");
    expect(header).toContain('rel="service-desc"');
    expect(relationTarget(header, "alternate")).toBe("/reviews/review%20example/versions/v2");
    expect(relationTarget(header, "latest-version")).toBe("/reviews/review%20example");
    expect(relationTarget(header, "version-history")).toBe(
      "/reviews/review%20example#record-details",
    );
    expect(relationTarget(header, "predecessor-version")).toBe(
      "/reviews/review%20example/versions/v1",
    );
    expect(relationTarget(header, "successor-version")).toBe(
      "/reviews/review%20example/versions/v3",
    );
    expect(header).not.toContain("unrelated");
  });

  it("does not advertise a tombstoned correction target", () => {
    const response = addReviewHypermediaLinks(
      new Response(),
      {
        slug: "example",
        version: { id: "v1" },
        versions: [
          { id: "v1", isCurrent: false, publicState: "published" },
          { id: "secret-v2", isCurrent: true, publicState: "tombstoned" },
        ],
        lifecycleEvents: [
          {
            kind: "correction",
            reviewVersionId: "secret-v2",
            supersedesVersionId: "v1",
          },
        ],
      },
      true,
    );

    expect(response.headers.get("link")).not.toContain("secret-v2");
    expect(response.headers.get("link")).not.toContain('rel="latest-version"');
    expect(response.headers.get("link")).not.toContain('rel="version-history"');
  });
});

describe("pagination hypermedia links", () => {
  it("replaces only the cursor and preserves the request query state", () => {
    const response = addNextPageLink(
      new Response(null, { headers: { Link: '</api-docs>; rel="service-doc"' } }),
      "https://atlas.example/api/graph?seed=n1&version=v1&direction=incoming&status=confirmed&relationType=supports&limit=2&cursor=old",
      "signed cursor/+",
    );

    const header = response.headers.get("link");
    expect(header).toContain('rel="service-doc"');
    const next = new URL(relationTarget(header, "next")!, "https://atlas.example");
    expect(Object.fromEntries(next.searchParams)).toEqual({
      seed: "n1",
      version: "v1",
      direction: "incoming",
      status: "confirmed",
      relationType: "supports",
      limit: "2",
      cursor: "signed cursor/+",
    });
  });

  it("does not add a next relation for a complete page", () => {
    const response = addNextPageLink(new Response(), "https://atlas.example/api/graph?seed=n1");
    expect(response.headers.get("link")).toBeNull();
  });
});
