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
          "graph:node-data": "/explore?interest=disagreements&focus=graph%3Anode-data",
        }}
        landscape={{
          matchedClaimCount: 1,
          shownClaimCount: 1,
          graphSeedCount: 1,
          graphNodeCount: 2,
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
              graphNodeId: "node-claim",
              graphNodeVersionId: "version-claim",
              graphHref: "/graph?seed=node-claim",
              graphRecordHref: "/nodes/node-claim/versions/version-claim",
            },
            {
              id: "graph:node-data",
              kind: "dataset",
              label: "Evaluation dataset",
              detail: "Dataset graph node · exact preserved graph version",
              href: "/nodes/node-data/versions/version-data",
              reasons: ["Directly connected to a claim selected for your interests"],
              graphNodeId: "node-data",
              graphNodeVersionId: "version-data",
              graphHref: "/graph?seed=node-data",
              graphRecordHref: "/nodes/node-data/versions/version-data",
            },
          ],
          edges: [
            {
              sourceId: "review:1",
              targetId: "claim:1",
              label: "asserts",
              relationType: "asserts",
            },
            {
              sourceId: "claim:1",
              targetId: "graph:node-data",
              label: "uses dataset",
              relationType: "uses-dataset",
              status: "confirmed",
              assessmentCount: 1,
            },
          ],
          timeline: [{ year: 2024, reviewCount: 1, evidenceCount: 0 }],
        }}
      />,
    );

    expect(html).toContain('aria-label="Guided knowledge landscape"');
    expect(html).toContain("Reviews connected to claims, evidence, and graph research objects");
    expect(html).toContain('aria-label="Knowledge landscape details"');
    expect(html).toContain('data-relation="contradicts"');
    expect(html).toContain('href="/claims/one/claim-1"');
    expect(html).toContain("A bounded path through");
    expect(html).toContain("Why this?");
    expect(html).toContain("Ordering helps exploration only");
    expect(html).toContain("When these records entered the literature");
    expect(html).toContain("Focus on connections");
    expect(html).toContain("Nodes worth exploring for this interest");
    expect(html).toContain("Explore graph neighborhood");
    expect(html).toContain("Inspect exact graph version");
    expect(html).toContain("Evaluation dataset");
  });
});
