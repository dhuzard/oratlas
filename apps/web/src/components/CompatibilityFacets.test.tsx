import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompatibilityFacets } from "./CompatibilityFacets.js";

describe("CompatibilityFacets", () => {
  it("renders every stored status and escapes evidence text", () => {
    const hostile = '<script data-test="facet-xss">alert(1)</script>';
    const html = renderToStaticMarkup(
      <CompatibilityFacets
        facets={{
          article: { status: "available", evidence: [hostile] },
          citations: { status: "partial", evidence: ["Citation evidence"] },
          evidencePackage: { status: "unavailable", evidence: ["Package evidence"] },
          claimGraph: { status: "available", evidence: ["Graph evidence"] },
          assessments: { status: "unknown", evidence: ["Assessment evidence"] },
        }}
      />,
    );

    expect(html).toContain("Compatibility by facet");
    expect(html).toContain("Article / prose");
    expect(html).toContain("Assessments (TRUST)");
    expect(html).toContain("&lt;script data-test=&quot;facet-xss&quot;&gt;");
    expect(html).not.toContain("<script");
  });

  it("does not infer facet truth for a legacy report", () => {
    const html = renderToStaticMarkup(<CompatibilityFacets />);
    expect(html).toContain("unavailable for this immutable legacy report");
    expect(html).not.toContain("data-compatibility-facet");
  });
});
