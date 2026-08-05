import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  buildIndex: vi.fn(),
  createResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/index-builder", () => ({ buildKnowledgeIndex: state.buildIndex }));
vi.mock("@/lib/knowledge-recommendation-service", () => ({
  createKnowledgeRecommendationResponse: state.createResponse,
}));

import { GET } from "./route";

describe("GET /api/landscape", () => {
  beforeEach(() => {
    state.buildIndex.mockReset().mockResolvedValue({ marker: "index" });
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
      { marker: "index" },
      expect.objectContaining({
        q: "model",
        interests: ["disagreements"],
        relationType: "contradicts",
        knownNodeIds: ["node-1"],
      }),
    );
  });

  it("rejects GUI-only focus state before reading the archive", async () => {
    const response = await GET(new Request("https://oratlas.test/api/landscape?focus=claim%3A1"));

    expect(response.status).toBe(400);
    expect(state.buildIndex).not.toHaveBeenCalled();
  });

  it("rejects unknown interests before reading the archive", async () => {
    const response = await GET(
      new Request("https://oratlas.test/api/landscape?interest=secret-profile"),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(state.buildIndex).not.toHaveBeenCalled();
  });
});
