import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KnowledgeLandscape } from "./KnowledgeLandscape.js";

describe("KnowledgeLandscape", () => {
  it("renders a visual graph and synchronized accessible details", () => {
    const html = renderToStaticMarkup(
      <KnowledgeLandscape
        focus="Disagreements"
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
            },
            {
              id: "claim:1",
              kind: "claim",
              label: "A disputed claim",
              detail: "Scientific claim",
              href: "/claims/one/claim-1",
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
        }}
      />,
    );

    expect(html).toContain('aria-label="Guided knowledge landscape"');
    expect(html).toContain('aria-label="Knowledge landscape details"');
    expect(html).toContain('href="/claims/one/claim-1"');
    expect(html).toContain("A bounded path through");
  });
});
