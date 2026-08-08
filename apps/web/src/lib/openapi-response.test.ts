import { describe, expect, it, vi } from "vitest";
import { OPENAPI_JSON_ETAG, OPENAPI_YAML_ETAG } from "@/generated/openapi-artifacts";
import { openApiResponse } from "./openapi-response";

vi.mock("server-only", () => ({}));

describe("public OpenAPI responses", () => {
  it.each([
    ["yaml", "application/yaml", "openapi: 3.1.0"],
    ["json", "application/json", '"openapi": "3.1.0"'],
  ] as const)("serves the generated %s artifact", async (format, mediaType, marker) => {
    const response = openApiResponse(
      new Request(`https://atlas.example/openapi.${format}`),
      format,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(mediaType);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(response.headers.get("etag")).toBe(
      format === "yaml" ? OPENAPI_YAML_ETAG : OPENAPI_JSON_ETAG,
    );
    expect(response.headers.get("link")).toContain('rel="service-desc"');
    expect(await response.text()).toContain(marker);
  });

  it("honors conditional requests", () => {
    const response = openApiResponse(
      new Request("https://atlas.example/openapi.yaml", {
        headers: { "If-None-Match": OPENAPI_YAML_ETAG },
      }),
      "yaml",
    );
    expect(response.status).toBe(304);
  });
});
