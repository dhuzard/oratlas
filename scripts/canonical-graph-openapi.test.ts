import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const openapi = parse(readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8"));

describe("canonical graph OpenAPI surface", () => {
  it("publishes exact-version keyset traversal instead of viewport-depth projection", () => {
    const operation = openapi.paths["/api/graph"].get;
    expect(operation.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/CanonicalGraphResponse",
    );
    const parameters = new Map(
      operation.parameters.map((parameter: { name: string }) => [parameter.name, parameter]),
    );
    expect(parameters.get("seed")).toMatchObject({ required: true });
    expect(parameters.has("version")).toBe(true);
    expect(parameters.has("direction")).toBe(true);
    expect(parameters.has("cursor")).toBe(true);
    expect(parameters.has("depth")).toBe(false);
    expect(parameters.has("q")).toBe(false);
    expect(parameters.has("edgeStatus")).toBe(false);
  });

  it("keeps reader and presentation state out of canonical node versions", () => {
    const schemas = openapi.components.schemas;
    for (const name of ["CanonicalGraphNodeVersion", "CanonicalGraphResponse"]) {
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
    const properties = schemas.CanonicalGraphNodeVersion.properties;
    for (const forbidden of [
      "href",
      "graphHref",
      "detail",
      "reasons",
      "score",
      "interests",
      "knownNodeIds",
    ]) {
      expect(properties).not.toHaveProperty(forbidden);
    }
    expect(properties.kind.enum).toEqual(["review", "claim", "work", "figure", "dataset", "code"]);
  });
});
