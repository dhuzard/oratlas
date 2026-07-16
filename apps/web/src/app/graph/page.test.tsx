import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/graph-query", () => ({
  GraphQueryError: class GraphQueryError extends Error {},
  queryPublicGraph: state.query,
}));

import GraphPage from "./page";

describe("/graph server route", () => {
  beforeEach(() => {
    state.query.mockReset().mockResolvedValue({
      schemaVersion: "1.0.0",
      seedNodeIds: [],
      depth: 1,
      nodes: [],
      edges: [],
      page: { limit: 10 },
    });
  });

  it("renders a useful no-query landing without touching storage", async () => {
    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Explore from a node");
    expect(html).toContain("Find a topic");
    expect(state.query).not.toHaveBeenCalled();
  });

  it("parses filters and calls the KG-08 query service directly", async () => {
    const html = renderToStaticMarkup(
      await GraphPage({
        searchParams: Promise.resolve({
          seed: "node-1",
          depth: "2",
          limit: "25",
          kind: "claim",
          relationType: "supports",
          edgeStatus: "confirmed",
          hasTrust: "false",
        }),
      }),
    );
    expect(state.query).toHaveBeenCalledWith({
      seed: "node-1",
      depth: 2,
      limit: 25,
      kind: "claim",
      relationType: "supports",
      edgeStatus: "confirmed",
      hasTrust: false,
    });
    expect(html).toContain("No public relations match this query");
  });

  it("fails invalid and duplicate parameters before querying storage", async () => {
    for (const params of [{ seed: "node-1", depth: "99" }, { seed: ["one", "two"] }]) {
      const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve(params) }));
      expect(html).toContain("Check the node or topic and filter values");
    }
    expect(state.query).not.toHaveBeenCalled();
  });

  it("does not leak unexpected server failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.query.mockRejectedValueOnce(new Error("private database detail"));
    const html = renderToStaticMarkup(
      await GraphPage({ searchParams: Promise.resolve({ seed: "node-1" }) }),
    );
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("private database detail");
    consoleError.mockRestore();
  });
});
