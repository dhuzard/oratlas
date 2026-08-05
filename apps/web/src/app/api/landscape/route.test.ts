import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/knowledge-recommendation-service", () => ({
  createKnowledgeRecommendationResponse: state.createResponse,
}));

import { GET } from "./route";

describe("GET /api/landscape", () => {
  beforeEach(() => {
    state.createResponse.mockReset().mockResolvedValue({ schemaVersion: "2.0.0" });
  });

  it("passes explicit ranking input to the recommendation service", async () => {
    const response = await GET(
      new Request(
        "https://oratlas.test/api/landscape?q=model&interest=disagreements&interest=disagreements&relationType=contradicts&known=node-1&known=node-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(state.createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "model",
        interests: ["disagreements"],
        relationType: "contradicts",
        knownNodeIds: ["node-1"],
      }),
    );
  });

  it("normalizes known node ids before deduplicating them", async () => {
    const response = await GET(
      new Request(
        "https://oratlas.test/api/landscape?interest=data-code&known=%20node-1%20&known=node-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(state.createResponse).toHaveBeenCalledWith(
      expect.objectContaining({ knownNodeIds: ["node-1"] }),
    );
  });

  it("requires an explicit recommendation scope before querying the graph", async () => {
    const response = await GET(new Request("https://oratlas.test/api/landscape"));

    expect(response.status).toBe(400);
    expect(state.createResponse).not.toHaveBeenCalled();
  });

  it("does not use a reader-held known set as an implicit archive-wide seed", async () => {
    const response = await GET(
      new Request("https://oratlas.test/api/landscape?known=known-node-1"),
    );

    expect(response.status).toBe(400);
    expect(state.createResponse).not.toHaveBeenCalled();
  });

  it("rejects GUI-only focus state before querying the graph", async () => {
    const response = await GET(new Request("https://oratlas.test/api/landscape?focus=claim%3A1"));

    expect(response.status).toBe(400);
    expect(state.createResponse).not.toHaveBeenCalled();
  });

  it("rejects unknown interests before querying the graph", async () => {
    const response = await GET(
      new Request("https://oratlas.test/api/landscape?interest=secret-profile"),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Invalid knowledge recommendation parameters");
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(state.createResponse).not.toHaveBeenCalled();
  });
});
