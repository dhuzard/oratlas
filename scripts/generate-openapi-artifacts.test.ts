import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  artifactPath,
  checkOpenApiArtifact,
  generateOpenApiArtifact,
  sourcePath,
} from "./generate-openapi-artifacts";

describe("OpenAPI artifact generation", () => {
  it("creates deterministic YAML, JSON and ETag constants", () => {
    const source = `openapi: 3.1.0\ninfo:\n  title: Example\n  version: 1.0.0\npaths: {}\n`;
    const generated = generateOpenApiArtifact(source);
    expect(generated).toContain("OPENAPI_YAML");
    expect(generated).toContain("OPENAPI_JSON");
    expect(generated.split("\n").find((line) => line.includes("OPENAPI_YAML_ETAG"))).toContain(
      "sha256-",
    );
    expect(generated.split("\n").find((line) => line.includes("OPENAPI_JSON_ETAG"))).toContain(
      "sha256-",
    );
    expect(generateOpenApiArtifact(source.replaceAll("\n", "\r\n"))).toBe(generated);
  });

  it("keeps the checked-in artifact synchronized with the only editable source", () => {
    const source = readFileSync(sourcePath, "utf8");
    const artifact = readFileSync(artifactPath, "utf8");
    expect(checkOpenApiArtifact(artifact)).toBe(true);
    const crlfArtifact = artifact.replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n");
    expect(checkOpenApiArtifact(crlfArtifact)).toBe(true);

    const parsed = parse(source) as { servers: Array<{ url: string }> };
    expect(parsed.servers[0]?.url).toBe("/");
  });
});
