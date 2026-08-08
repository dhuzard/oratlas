import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  budget: { ok: true, remaining: 9, resetAt: Date.now() + 60_000 },
  query: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "test:public-graph",
  rateLimitDefaults: () => ({ max: 10, windowMs: 60_000 }),
  rateLimit: () => state.budget,
}));

vi.mock("@/lib/canonical-graph-query", () => ({
  CanonicalGraphQueryError: class CanonicalGraphQueryError extends Error {
    code = "bad-request" as const;
  },
  queryCanonicalGraph: state.query,
}));

import { GET } from "./route";

describe("GET /api/graph", () => {
  beforeEach(() => {
    state.budget = { ok: true, remaining: 9, resetAt: Date.now() + 60_000 };
    state.query.mockReset().mockResolvedValue({
      schemaVersion: "2.0.0",
      seed: { nodeId: "n1", nodeVersionId: "v1" },
      nodes: [],
      edges: [],
      page: { limit: 25 },
    });
  });

  it("rejects obsolete multi-depth traversal parameters before querying storage", async () => {
    const response = await GET(new Request("https://oratlas.test/api/graph?seed=n1&depth=4"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(response.headers.get("ratelimit-limit")).toBe("10");
    expect(response.headers.get("ratelimit-remaining")).toBe("9");
    expect(response.headers.get("ratelimit-reset")).toMatch(/^\d+$/);
    expect(await response.json()).toMatchObject({ error: { code: "bad-request" } });
    expect(state.query).not.toHaveBeenCalled();
  });

  it("uses the shared route budget and returns a typed 429 with Retry-After", async () => {
    state.budget = { ok: false, remaining: 0, resetAt: Date.now() + 30_000 };
    const response = await GET(new Request("https://oratlas.test/api/graph?seed=n1"));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(response.headers.get("ratelimit-limit")).toBe("10");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-reset")).toMatch(/^\d+$/);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(await response.json()).toEqual({
      error: { code: "rate-limited", message: "Too many graph requests." },
    });
  });

  it("accepts exact-version authoritative traversal and disables caching", async () => {
    const response = await GET(
      new Request(
        "https://oratlas.test/api/graph?seed=n1&version=v1&status=source-assertion&direction=incoming",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(state.query).toHaveBeenCalledWith(
      expect.objectContaining({
        seed: "n1",
        version: "v1",
        status: "source-assertion",
        direction: "incoming",
      }),
    );
  });

  it("advertises the next page without dropping graph query state or discovery links", async () => {
    state.query.mockResolvedValueOnce({
      schemaVersion: "2.0.0",
      seed: { nodeId: "n1", nodeVersionId: "v1" },
      nodes: [],
      edges: [],
      page: { limit: 2, nextCursor: "signed cursor/+" },
    });
    const response = await GET(
      new Request(
        "https://oratlas.test/api/graph?seed=n1&version=v1&direction=incoming&status=confirmed&relationType=supports&limit=2&cursor=old",
      ),
    );

    const links = response.headers.get("link");
    expect(links).toContain('rel="service-desc"');
    expect(links).toContain('rel="service-doc"');
    const nextTarget = links
      ?.split(",")
      .find((value) => value.includes('rel="next"'))
      ?.match(/<([^>]+)>/)?.[1];
    const next = new URL(nextTarget!, "https://oratlas.test");
    expect(Object.fromEntries(next.searchParams)).toEqual({
      seed: "n1",
      version: "v1",
      direction: "incoming",
      status: "confirmed",
      relationType: "supports",
      limit: "2",
      cursor: "signed cursor/+",
    });
  });

  it("does not advertise a next page when the response has no cursor", async () => {
    const response = await GET(new Request("https://oratlas.test/api/graph?seed=n1"));
    expect(response.headers.get("link")).not.toContain('rel="next"');
  });

  it("applies no-store and rate metadata to unexpected errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.query.mockRejectedValueOnce(new Error("private database detail"));
    const response = await GET(new Request("https://oratlas.test/api/graph?seed=n1"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(response.headers.get("ratelimit-limit")).toBe("10");
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    consoleError.mockRestore();
  });
});
