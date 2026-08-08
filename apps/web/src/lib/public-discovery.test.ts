import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@oratlas/config";
import {
  PUBLIC_PATHS,
  addDiscoveryHeaders,
  buildLlmsText,
  canonicalOrigin,
} from "./public-discovery";

vi.mock("server-only", () => ({}));

describe("public discovery registry", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://atlas.example");
    resetServerEnvCache();
  });

  it("builds canonical public URLs from one configured origin", () => {
    expect(canonicalOrigin().toString()).toBe("https://atlas.example/");
    const text = buildLlmsText();
    const advertised = Object.entries(PUBLIC_PATHS)
      .filter(([name]) => name !== "llms")
      .map(([, path]) => path);
    for (const path of advertised) {
      expect(text).toContain(new URL(path, "https://atlas.example").toString());
    }
    expect(text).toContain("not authorization");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("adds registered service discovery links without replacing other links", () => {
    const response = new Response(null, { headers: { Link: '<https://example.test>; rel="up"' } });
    addDiscoveryHeaders(response);
    addDiscoveryHeaders(response);

    const links = response.headers.get("link") ?? "";
    expect(links).toContain('rel="up"');
    expect(links.match(/rel="service-desc"/g)).toHaveLength(1);
    expect(links.match(/rel="service-doc"/g)).toHaveLength(1);
  });
});
