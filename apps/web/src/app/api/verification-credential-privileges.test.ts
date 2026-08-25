import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
}));

const verifierToken = `oratlas_verify_${"a".repeat(12)}.${"b".repeat(43)}`;
function request(path: string, body: unknown) {
  return new Request(`https://atlas.example${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${verifierToken}`,
      "content-type": "application/json",
      origin: "https://atlas.example",
    },
    body: JSON.stringify(body),
  });
}

describe("verifier credential privilege boundary", () => {
  it("does not authorize publication, canonical graph, TRUST, certification, or editor mutations", async () => {
    const [publication, graph, trust, certification, verificationRequest] = await Promise.all([
      import("./editorial/publications/register/route"),
      import("./editorial/graph-curation/route"),
      import("./editorial/trust/route"),
      import("./certification-runs/[id]/result/route"),
      import("./verification-runs/route"),
    ]);
    const responses = await Promise.all([
      publication.POST(
        request("/api/editorial/publications/register", {
          manifestUrl: "https://example.org/manifest.json",
        }),
      ),
      graph.POST(request("/api/editorial/graph-curation", {})),
      trust.POST(request("/api/editorial/trust", {})),
      certification.POST(request("/api/certification-runs/run-other/result", {}), {
        params: Promise.resolve({ id: "run-other" }),
      }),
      verificationRequest.POST(request("/api/verification-runs", {})),
    ]);
    expect(responses.every((response) => response.status === 401 || response.status === 403)).toBe(
      true,
    );
  }, 20_000);
});
