import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KnowledgeLandscape } from "./KnowledgeLandscape.js";

describe("KnowledgeLandscape", () => {
  it("renders a visual graph and synchronized accessible details", () => {
    const html = renderToStaticMarkup(
      <KnowledgeLandscape
        focus="Disagreements"
        overviewHref="/explore?interest=disagreements"
        focusHrefByNode={{
          "review:1": "/explore?interest=disagreements&focus=review%3A1",
          "claim:1": "/explore?interest=disagreements&focus=claim%3A1",
        }}
        landscape={{
          matchedClaimCount: 1,
          shownClaimCount: 1,
          nodes: [
            {
              id: "review:1",
              kind: "review",
              label: "Review one",
              detail: "Preserved review record",
              href: "/reviews/one",
              reasons: ["Contains a claim in this landscape"],
              year: 2024,
            },
            {
              id: "claim:1",
              kind: "claim",
              label: "A disputed claim",
              detail: "Scientific claim",
              href: "/claims/one/claim-1",
              reasons: ["Matches your disagreements interest"],
              year: 2024,
            },
          ],
          edges: [
            {
              sourceId: "review:1",
              targetId: "claim:1",
              label: "asserts",
              relationType: "asserts",
            },
          ],
          timeline: [{ year: 2024, reviewCount: 1, evidenceCount: 0 }],
        }}
      />,
    );

    expect(html).toContain('aria-label="Guided knowledge landscape"');
    expect(html).toContain('aria-label="Knowledge landscape details"');
    expect(html).toContain('data-relation="contradicts"');
    expect(html).toContain('href="/claims/one/claim-1"');
    expect(html).toContain("A bounded path through");
    expect(html).toContain("Why this?");
    expect(html).toContain("Ordering helps exploration only");
    expect(html).toContain("When these records entered the literature");
    expect(html).toContain("Focus on connections");
  });
});
