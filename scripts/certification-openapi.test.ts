import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const openapi = parse(readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8"));

describe("certification OpenAPI contract", () => {
  it("documents the immutable publication content corpus used by packet 1.2", () => {
    const packet = openapi.components.schemas.PublicationVersionPacket;
    expect(packet.properties.schemaVersion.const).toBe("1.2.0");
    expect(packet.required).toEqual(expect.arrayContaining(["content", "completeness"]));
    expect(packet.properties.content.items).toEqual({
      $ref: "#/components/schemas/PublicationContentDocument",
    });

    const contentOperation = openapi.paths["/api/publication-versions/{id}/content"].get;
    expect(contentOperation.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/PublicationVersionContent",
    });
    const contentProjection =
      openapi.components.schemas.PublicationVersionContent.properties.content;
    expect(contentProjection.items).toEqual(packet.properties.content.items);
    expect(contentProjection.maxItems).toBe(packet.properties.content.maxItems);
    expect(contentOperation.responses["404"].$ref).toBe("#/components/responses/Error");
  });

  it("documents the strict external result submission contract", () => {
    const requestSchema =
      openapi.paths["/api/certification-runs/{id}/result"].post.requestBody.content[
        "application/json"
      ].schema;
    expect(requestSchema).toEqual({ $ref: "#/components/schemas/SubmitCertificationResult" });

    const schema = openapi.components.schemas.SubmitCertificationResult;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "packetSha256",
        "criteria",
        "outcome",
        "conflictOfInterest",
        "independence",
      ]),
    );
    expect(schema.properties.criteria.items).toEqual({
      $ref: "#/components/schemas/CertificationCriterionResult",
    });
    expect(schema.properties.provenance.additionalProperties).toBe(false);
  });
});
