import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@oratlas/config";
import robots from "./robots";

vi.mock("server-only", () => ({}));

describe("robots metadata", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://atlas.example");
    resetServerEnvCache();
  });

  it("advertises the canonical sitemap without blocking public APIs", () => {
    const metadata = robots();
    const rules = Array.isArray(metadata.rules) ? metadata.rules : [metadata.rules];
    const disallowed = rules.flatMap((rule) => rule.disallow ?? []);

    expect(metadata.sitemap).toBe("https://atlas.example/sitemap.xml");
    expect(metadata.host).toBe("https://atlas.example");
    expect(disallowed).toEqual(
      expect.arrayContaining(["/signin", "/editorial", "/submit", "/api/auth/"]),
    );
    expect(disallowed).not.toContain("/api/");
    expect(disallowed).not.toContain("/api/search");
    expect(disallowed).not.toContain("/api/graph");
  });
});
