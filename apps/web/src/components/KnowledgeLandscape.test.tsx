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
          "claim:1": "/explore?interest=disagreements&focus=node-claim",
          "graph:node-data": "/explore?interest=disagreements&focus=node-data",
        }}
        knownNodeIds={["node-claim"]}
        knownToggleHrefByNode={{
          "node-claim": "/explore?interest=disagreements",
          "node-data": "/explore?interest=disagreements&known=node-claim&known=node-data",
        }}
        clearKnownHref="/explore?interest=disagreements"
        focusedGraphNodeId={undefined}
        labelByGraphNodeVersionId={{
          "version-claim": "A disputed claim",
          "version-data": "Evaluation dataset",
          "version-data-old": "Earlier evaluation dataset",
        }}
        anchorsByLandscapeNodeId={{
          "graph:node-data": [
            {
              edgeId: "edge-claim-data",
              relationType: "uses-dataset",
              directionFromRecommendation: "incoming",
              recommendedNodeVersionId: "version-data",
              knownNodeId: "node-claim",
              knownNodeVersionId: "version-claim",
            },
          ],
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
            {
              id: "graph:node-data:old",
              kind: "dataset",
              label: "Earlier evaluation dataset",
              detail: "Dataset graph node · exact preserved graph version",
              href: "/nodes/node-data/versions/version-data-old",
              reasons: ["Another readable occurrence of the stable node"],
              graphNodeId: "node-data",
              graphNodeVersionId: "version-data-old",
              graphHref: "/graph?seed=node-data",
              graphRecordHref: "/nodes/node-data/versions/version-data-old",
            },
          ],
          edges: [
            {
              graphEdgeId: "edge-review-claim",
              sourceId: "review:1",
              targetId: "claim:1",
              label: "asserts",
              relationType: "asserts",
            },
            {
              graphEdgeId: "edge-claim-data",
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
    expect(html).toContain("Explore graph neighborhood");
    expect(html).toContain("Inspect exact graph version");
    expect(html).toContain("Evaluation dataset");
    expect(html).toContain("Your explicit known set contains 1 graph node");
    expect(html).toContain("Remove from known set");
    expect(html).toContain("Mark as known");
    expect(html).toContain("Anchored to 1 known graph node");
    expect(html).toContain("No confirmed direct anchor to your known set");
    expect(html).toContain("uses-dataset");
    expect(html).toContain("New nodes connected to what you know");
    expect(html).toContain("A disputed claim");
    expect(html).toContain('href="/explore?interest=disagreements&amp;focus=node-data"');
  });
});
