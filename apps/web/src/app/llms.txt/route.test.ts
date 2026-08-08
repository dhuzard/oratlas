import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@oratlas/config";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

describe("GET /llms.txt", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://atlas.example");
    resetServerEnvCache();
  });

  it("serves deterministic plain-text discovery with service links", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(response.headers.get("link")).toContain('rel="service-desc"');
    expect(await response.text()).toContain("https://atlas.example/openapi.yaml");
  });
});
