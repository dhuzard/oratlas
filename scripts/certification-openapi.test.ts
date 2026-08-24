import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const openapi = parse(readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8"));

describe("certification OpenAPI contract", () => {
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
