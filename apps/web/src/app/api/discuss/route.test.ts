import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  runDiscussion: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@oratlas/config", () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/discuss", () => ({ runDiscussion: mocks.runDiscussion }));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "test:discuss",
  rateLimit: () => ({ ok: true }),
}));

import { POST } from "./route";

describe("Discuss mutation request integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
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
});
