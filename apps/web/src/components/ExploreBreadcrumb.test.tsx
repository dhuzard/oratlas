import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExploreBreadcrumb } from "./ExploreBreadcrumb.js";

describe("ExploreBreadcrumb", () => {
  it("returns readers to the requested Explore view", () => {
    const html = renderToStaticMarkup(
      <ExploreBreadcrumb current="Claim passport" href="/explore?view=claims" />,
    );

    expect(html).toContain('href="/explore?view=claims"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Claim passport");
  });

  it("includes an optional parent for deeper contextual routes", () => {
    const html = renderToStaticMarkup(
      <ExploreBreadcrumb
        current="Brief title"
        parent={{ href: "/replications", label: "Replication briefs" }}
      />,
    );

    expect(html).toContain('href="/explore"');
    expect(html).toContain('href="/replications"');
  });

  it("can return archive readers to the review-first root", () => {
    const html = renderToStaticMarkup(
      <ExploreBreadcrumb current="Review record" href="/archive" rootLabel="Reviews" />,
    );

    expect(html).toContain('href="/archive"');
    expect(html).toContain(">Reviews</a>");
  });
});
