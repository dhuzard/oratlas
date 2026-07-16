import { describe, expect, it } from "vitest";
import { GRAPH_MAX_DEPTH, GRAPH_MAX_PAGE_SIZE, publicGraphQuerySchema } from "./graph.js";

describe("public graph contracts", () => {
  it("applies bounded defaults", () => {
    expect(publicGraphQuerySchema.parse({ seed: "node-1" })).toMatchObject({
      depth: 1,
      limit: 25,
      edgeStatus: "confirmed",
    });
  });

  it.each([
    { seed: "node-1", depth: GRAPH_MAX_DEPTH + 1 },
    { seed: "node-1", limit: GRAPH_MAX_PAGE_SIZE + 1 },
    { seed: "node-1", edgeStatus: "rejected" },
    { seed: "node-1", q: "topic" },
    {},
  ])("rejects an unsafe graph query %#", (query) => {
    expect(publicGraphQuerySchema.safeParse(query).success).toBe(false);
  });
});
