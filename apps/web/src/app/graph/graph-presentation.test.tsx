import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { publicGraphQuerySchema, type PublicGraphResponse } from "@oratlas/contracts";
import { GraphExplorer } from "./GraphExplorer";
import { graphHref, graphNodeVersionHref, relationPresentation } from "./graph-presentation";

const hostile = `<img src=x onerror="private-token"> & "quoted"`;
const node = (id: string, versionId: string, title: string, isExample = false) => ({
  id,
  localNodeId: `local-${id}`,
  kind: "claim" as const,
  repository: { owner: "public", name: "atlas", url: "https://github.com/public/atlas" },
  versionId,
  snapshotId: `snapshot-${id}`,
  commitSha: "a".repeat(40),
  title,
  provenance: { sourcePath: `nodes/${id}.json` },
  identifiers: isExample
    ? [
        {
          scheme: "doi" as const,
          role: "version-doi" as const,
          value: "10.5555/hostile",
          isExample: true,
        },
      ]
    : [],
  createdAt: "2026-07-16T00:00:00.000Z",
});

const result: PublicGraphResponse = {
  schemaVersion: "1.0.0",
  seedNodeIds: ["node/a"],
  depth: 1,
  nodes: [node("node/a", "version/a", hostile), node("node-b", "version-b", "Target", true)],
  edges: [
    {
      id: "edge-1",
      sourceNodeId: "node/a",
      sourceVersionId: "version/a",
      targetNodeId: "node-b",
      targetVersionId: "version-b",
      relationType: "contradicts",
      status: "proposed",
      provenance: "proposed-by-agent",
      rationale: hostile,
      proposedAt: "2026-07-16T00:00:00.000Z",
    },
  ],
  page: { limit: 1, nextCursor: "signed.cursor" },
};

describe("graph presentation", () => {
  it("builds exact-version and query-bound cursor links", () => {
    const query = publicGraphQuerySchema.parse({
      seed: "node/a",
      depth: 2,
      limit: 1,
      relationType: "contradicts",
      edgeStatus: "proposed",
    });
    expect(graphNodeVersionHref(result.nodes[0]!)).toBe("/nodes/node%2Fa/versions/version%2Fa");
    const next = graphHref(query, { cursor: "signed.cursor" });
    expect(next).toContain("seed=node%2Fa");
    expect(next).toContain("relationType=contradicts");
    expect(next).toContain("edgeStatus=proposed");
    expect(next).toContain("cursor=signed.cursor");
  });

  it("uses redundant status/relation semantics and escapes hostile stored text", () => {
    expect(relationPresentation(result.edges[0]!)).toMatchObject({
      statusLabel: "Proposed",
      statusSymbol: "◇",
      relationSymbol: "⊣",
      className: expect.stringContaining("graph-edge-proposed"),
    });
    const query = publicGraphQuerySchema.parse({
      seed: "node/a",
      limit: 1,
      edgeStatus: "proposed",
    });
    const html = renderToStaticMarkup(<GraphExplorer result={result} query={query} />);
    expect(html).toContain("&lt;img src=x onerror=&quot;private-token&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Proposed");
    expect(html).toContain("contradicts");
    expect(html).toContain("graph-edge-proposed");
    expect(html).toContain("graph-edge-contradicts");
    expect(html).toContain("example — not linked");
    expect(html).not.toContain("https://doi.org");
    expect(html).not.toContain("AgentRun");
    expect(html).not.toContain("evidenceJson");
  });

  it("renders legacy singleton TRUST with an explicit missing-assessor fallback", () => {
    const legacyResult = {
      ...result,
      edges: [
        {
          ...result.edges[0],
          status: "confirmed",
          provenance: "confirmed-by-editor",
          confirmedAt: "2026-07-16T00:00:00.000Z",
          proposedAt: undefined,
          trust: {
            protocolVersion: "TRUST-1.0",
            reviewStatus: "human-reviewed",
            verificationState: "platform-verified",
          },
        },
      ],
    } as unknown as PublicGraphResponse;
    const query = publicGraphQuerySchema.parse({ seed: "node/a", limit: 1 });
    const html = renderToStaticMarkup(<GraphExplorer result={legacyResult} query={query} />);

    expect(html).toContain("relation TRUST: 1 assessment");
    expect(html).toContain("not supplied (legacy), TRUST-1.0");
  });
});
