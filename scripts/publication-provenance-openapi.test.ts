import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const openapi = parse(readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8"));
const componentDocumentId = "https://oratlas.example/openapi-components";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(
  { $id: componentDocumentId, components: { schemas: openapi.components.schemas } },
  componentDocumentId,
);

function validator(name: string) {
  return ajv.compile({ $ref: `${componentDocumentId}#/components/schemas/${name}` });
}

describe("publication provenance OpenAPI contracts", () => {
  it("requires a declared actor name or identifier", () => {
    const validate = validator("PublicationProductionActor");
    expect(validate({ kind: "software", name: "Authoring workflow" })).toBe(true);
    expect(validate({ kind: "software", identifier: "urn:workflow:authoring" })).toBe(true);
    expect(validate({ kind: "software" })).toBe(false);
  });

  it("matches the runtime execution constraints for assertion mutations", () => {
    const validate = validator("PublicationProductionMutation");
    const source = {
      mode: "human",
      actors: [{ kind: "person", name: "Declared authors" }],
      activities: ["authoring"],
      strength: "source-declared",
    };
    expect(validate(source)).toBe(true);
    expect(validate({ ...source, agentRunId: "run-1" })).toBe(false);

    const attested = {
      mode: "agentic",
      actors: [{ kind: "ai-system", name: "Research agent" }],
      activities: ["evidence-synthesis"],
      strength: "oratlas-attested",
    };
    expect(validate(attested)).toBe(false);
    expect(validate({ ...attested, executionPassportId: "passport-1" })).toBe(true);
  });

  it("accepts real closed response shapes without mutation-schema composition conflicts", () => {
    const assertion = validator("PublicationProductionAssertion");
    const relation = validator("PublicationRelation");
    expect(
      assertion({
        id: "assertion-1",
        publicationVersionId: "version-1",
        sourceAssertionKey: null,
        mode: "human",
        actors: [{ kind: "person", name: "Declared authors" }],
        activities: ["authoring"],
        statement: null,
        strength: "source-declared",
        lifecycleState: "active",
        publicEvidenceUrl: null,
        agentRunId: null,
        executionPassportId: null,
        supersedesAssertionId: null,
        supersededByAssertionId: null,
        assertedBy: { id: "editor-1", githubLogin: "editor" },
        assertedAt: "2026-08-24T00:00:00.000Z",
        links: {
          publicationVersion: "/api/publication-versions/version-1",
          executionPassport: null,
          publicEvidence: null,
        },
      }),
    ).toBe(true);
    expect(
      relation({
        id: "relation-1",
        sourcePublicationId: "publication-1",
        targetPublicationId: "publication-2",
        relationType: "moved-to",
        direction: "outgoing",
        rationale: "An editor reviewed the transfer evidence.",
        publicEvidenceUrl: null,
        reviewedBy: { id: "editor-1", githubLogin: "editor" },
        reviewedAt: "2026-08-24T00:00:00.000Z",
        links: {
          sourcePublication: "/api/publications/publication-1",
          targetPublication: "/api/publications/publication-2",
          publicEvidence: null,
        },
      }),
    ).toBe(true);
  });

  it("documents relation creation and exact replay as distinct success statuses", () => {
    const responses = openapi.paths["/api/editorial/publications/{id}/relations"].post.responses;
    expect(responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/PublicationRelation",
    );
    expect(responses["201"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/PublicationRelation",
    );
    expect(
      openapi.paths["/api/editorial/publication-versions/{id}/production-provenance"].post
        .responses,
    ).not.toHaveProperty("200");
  });
});
