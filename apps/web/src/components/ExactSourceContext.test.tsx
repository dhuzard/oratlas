import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExactSourceContext } from "./ExactSourceContext";

describe("exact source context", () => {
  it("keeps a withdrawn historical review reference separate from the original source", () => {
    const html = renderToStaticMarkup(
      <ExactSourceContext
        kind="Archived review"
        versionId="historical-version"
        preservedHref="/reviews/review-a/versions/historical-version#record"
        originalUrl="https://example.org/current-review"
        locator="Results · claim-a"
        lifecycle="Withdrawn; preserved for inspection."
        coverage={["Only the recorded declaration is available; no separate passage was captured."]}
      />,
    );
    expect(html).toContain('href="/reviews/review-a/versions/historical-version#record"');
    expect(html).toContain('href="https://example.org/current-review" rel="external"');
    expect(html).toContain("Withdrawn; preserved for inspection.");
    expect(html).toContain("Publisher pages may have changed since capture.");
    expect(html).not.toContain('href="/reviews/review-a"');
  });

  it("preserves an external occurrence without inventing a canonical binding or lifecycle", () => {
    const html = renderToStaticMarkup(
      <ExactSourceContext
        kind="External publication"
        versionId="publication-version-a"
        preservedHref="/api/publication-claim-occurrences/occurrence-a"
        lifecycle="No publication withdrawal state is recorded by this source model."
        identity={[{ label: "Canonical binding", value: "No canonical binding is recorded." }]}
        coverage={["Evidence graph coverage is unavailable without a canonical binding."]}
      />,
    );
    expect(html).toContain('href="/api/publication-claim-occurrences/occurrence-a"');
    expect(html).toContain("No passage locator was recorded.");
    expect(html).toContain("No canonical binding is recorded.");
    expect(html).toContain("No publication withdrawal state is recorded by this source model.");
    expect(html).not.toContain('href="/nodes/');
    expect(html).not.toContain('rel="external"');
  });

  it("renders untrusted source context as text without executing or rendering source markup", () => {
    const sourceText = '<img src=x onerror="alert(1)">';
    const html = renderToStaticMarkup(
      <ExactSourceContext
        kind="Repository research object"
        versionId="node-version-a"
        preservedHref="/nodes/node-a/versions/node-version-a"
        lifecycle="Public research object"
        locator={sourceText}
        identity={[{ label: "Source pointer", value: sourceText }]}
        coverage={[sourceText]}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain('href="/nodes/node-a/versions/node-version-a"');
  });
});
