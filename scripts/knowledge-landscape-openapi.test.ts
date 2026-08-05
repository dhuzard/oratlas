import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const openapi = parse(readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8"));

describe("knowledge recommendation OpenAPI surface", () => {
  it("publishes the bounded reference-only contract and typed error", () => {
    const operation = openapi.paths["/api/landscape"].get;
    expect(operation.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/KnowledgeRecommendationResponse",
    );
    expect(operation.responses["400"].$ref).toBe("#/components/responses/Error");
    expect(
      operation.parameters.find((parameter: { name: string }) => parameter.name === "interest"),
    ).toMatchObject({ schema: { maxItems: 5 } });
  });

  it("labels the algorithm as recommendation rather than scientific scoring", () => {
    const schemas = openapi.components.schemas;
    for (const name of [
      "KnowledgeRecommendationQuery",
      "KnowledgeRecommendation",
      "KnowledgeRecommendationResponse",
    ]) {
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
    expect(
      schemas.KnowledgeRecommendationResponse.properties.algorithm.properties.purpose.const,
    ).toBe("recommendation");
    expect(
      schemas.KnowledgeRecommendationResponse.properties.algorithm.properties.limitations.prefixItems.map(
        (item: { const: string }) => item.const,
      ),
    ).toEqual([
      "not-a-truth-score",
      "not-a-quality-score",
      "confirmed-graph-edges-only",
      "bounded-to-six-claims-ten-evidence-and-twelve-graph-nodes",
    ]);
  });
});
