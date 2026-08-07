import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientKey: vi.fn(),
  getCurrentUser: vi.fn(),
  rateLimit: vi.fn(),
  runDiscussion: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@oratlas/config", () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/discuss", () => ({ runDiscussion: mocks.runDiscussion }));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: mocks.clientKey,
  rateLimit: mocks.rateLimit,
}));

import { POST } from "./route";

const scope = {
  nodes: [{ nodeId: "node-1", nodeVersionId: "version-1" }],
  edgeIds: [],
  signature: "a".repeat(43),
};

describe("Discuss mutation request integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientKey.mockImplementation((_headers: Headers, suffix: string) => `test:${suffix}`);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.rateLimit.mockReturnValue({ ok: true, remaining: 14, resetAt: Date.now() + 60_000 });
    mocks.runDiscussion.mockResolvedValue({ answer: "grounded" });
  });

  it("rejects a simple cross-site text request before provider or provenance work", async () => {
    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "text/plain",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ question: "What evidence is available?" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.runDiscussion).not.toHaveBeenCalled();
  });

  it("rejects cross-origin JSON even without request-scoped credentials", async () => {
    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ question: "What evidence is available?" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.runDiscussion).not.toHaveBeenCalled();
  });

  it("rejects a question without an exact traversed graph scope", async () => {
    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ question: "What evidence is available?" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.runDiscussion).not.toHaveBeenCalled();
  });

  it("passes only the exact traversal contract to the discussion runner", async () => {
    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ question: "What evidence is available?", scope }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runDiscussion).toHaveBeenCalledWith(
      "What evidence is available?",
      scope,
      undefined,
      { allowServerProvider: false, persistAgentRun: false },
    );
  });

  it("allows authenticated discussion provenance and the configured provider", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ question: "What evidence is available?", scope }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runDiscussion).toHaveBeenCalledWith(
      "What evidence is available?",
      scope,
      undefined,
      { allowServerProvider: true, persistAgentRun: true },
    );
  });

  it("applies a tighter budget to anonymous provider-backed requests", async () => {
    mocks.rateLimit
      .mockReturnValueOnce({ ok: true, remaining: 14, resetAt: Date.now() + 60_000 })
      .mockReturnValueOnce({ ok: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({
          question: "What evidence is available?",
          scope,
          llm: { provider: "openai", apiKey: "sk-test-key-with-enough-characters" },
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.clientKey).toHaveBeenCalledWith(expect.any(Headers), "discuss:anonymous-byok");
    expect(mocks.runDiscussion).not.toHaveBeenCalled();
  });

  it("keeps an allowed anonymous BYOK answer response-only", async () => {
    const llm = { provider: "openai", apiKey: "sk-test-key-with-enough-characters" };
    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ question: "What evidence is available?", scope, llm }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.runDiscussion).toHaveBeenCalledWith("What evidence is available?", scope, llm, {
      allowServerProvider: false,
      persistAgentRun: false,
    });
  });

  it("rejects unknown request-scoped credential fields", async () => {
    const response = await POST(
      new Request("https://atlas.example/api/discuss", {
        method: "POST",
        headers: {
          Origin: "https://atlas.example",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({
          question: "What evidence is available?",
          scope,
          llm: {
            provider: "openai",
            apiKey: "sk-test-key-with-enough-characters",
            persist: true,
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.runDiscussion).not.toHaveBeenCalled();
  });
});
