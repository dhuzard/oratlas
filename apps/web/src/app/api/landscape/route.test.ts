import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  buildIndex: vi.fn(),
  createResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/index-builder", () => ({ buildKnowledgeIndex: state.buildIndex }));
vi.mock("@/lib/knowledge-landscape-service", () => ({
  createKnowledgeLandscapeResponse: state.createResponse,
}));

import { GET } from "./route";

describe("GET /api/landscape", () => {
  beforeEach(() => {
    state.buildIndex.mockReset().mockResolvedValue({ marker: "index" });
    state.createResponse.mockReset().mockReturnValue({ schemaVersion: "1.0.0" });
  });

  it("passes the GUI's explicit URL state to the shared landscape service", async () => {
    const response = await GET(
      new Request(
        "https://oratlas.test/api/landscape?q=model&interest=disagreements&interest=disagreements&focus=claim%3A1&relationType=contradicts",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(state.createResponse).toHaveBeenCalledWith(
      { marker: "index" },
      expect.objectContaining({
        q: "model",
        interests: ["disagreements"],
        focusNodeId: "claim:1",
        relationType: "contradicts",
      }),
    );
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
