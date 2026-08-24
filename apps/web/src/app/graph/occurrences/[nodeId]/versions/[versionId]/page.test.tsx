import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/canonical-graph-query", () => ({
  CanonicalGraphQueryError: class CanonicalGraphQueryError extends Error {
    code = "not-found";
  },
  queryCanonicalGraph: state.query,
}));

import CanonicalOccurrencePage from "./page";

describe("external publication canonical occurrence page", () => {
  beforeEach(() => {
    state.query.mockReset().mockResolvedValue({
      schemaVersion: "2.0.0",
      nodes: [
        {
          nodeId: "node-b1",
          nodeVersionId: "version-b1",
          localNodeId: "occurrence-b1",
          kind: "claim",
          title: null,
          abstract: null,
          text: "The intervention does not improve the outcome.",
          payload: { statement: "The intervention does not improve the outcome.", qualifiers: [] },
          source: {
            type: "publication-claim-occurrence",
            publicationClaimOccurrenceId: "occurrence-b1",
            publicationId: "publication-b",
            publicationVersionId: "publication-version-b",
            publicationType: "research-article",
            sourceLocalClaimId: "claim-b1",
            adapterType: "myst",
            structuralProvenance: "published-structure",
            publisherCanonicalUrl: null,
            observedPublicationBaseUrl: "https://site-b.example/publication/",
            publishedTargetUrl: "https://site-b.example/publication/results/#source-claim-b1",
            captureIds: ["capture-manifest", "capture-claim-stream"],
            sourcesSha256: "b".repeat(64),
          },
          repository: null,
          trust: [],
          createdAt: "2026-08-24T00:00:00.000Z",
        },
      ],
      edges: [],
      page: { limit: 100 },
    });
  });

  it("round-trips a reader to the exact external page anchor", async () => {
    const html = renderToStaticMarkup(
      await CanonicalOccurrencePage({
        params: Promise.resolve({ nodeId: "node-b1", versionId: "version-b1" }),
      }),
    );

    expect(html).toContain("Open original publication");
    expect(html).toContain('href="https://site-b.example/publication/results/#source-claim-b1"');
    expect(html).toContain(
      "publication publication-b, version publication-version-b, claim claim-b1",
    );
  });
});
