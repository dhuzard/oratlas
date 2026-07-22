import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const openapi = parse(readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8"));
const schemas = openapi.components.schemas;
const paths = openapi.paths;

describe("challenge OpenAPI surface", () => {
  const mutationCases = [
    [
      "/api/reviews/{slug}/versions/{versionId}/challenges",
      "ChallengeCreateRequest",
      "201",
      "ChallengeCreateResponse",
    ],
    [
      "/api/challenges/{id}/transitions",
      "ChallengeTransitionRequest",
      "200",
      "ChallengeTransitionResponse",
    ],
    [
      "/api/challenges/{id}/responses",
      "ChallengeResponseCreateRequest",
      "200",
      "ChallengeResponseCreateResponse",
    ],
    [
      "/api/challenges/{id}/moderation",
      "ChallengeModerationRequest",
      "200",
      "ChallengeModerationResponse",
    ],
    [
      "/api/challenge-responses/{id}/moderation",
      "ChallengeModerationRequest",
      "200",
      "ChallengeModerationResponse",
    ],
  ] as const;

  it.each(mutationCases)(
    "types requests, successes, and the exact shared error surface for %s",
    (path, requestSchema, successStatus, successSchema) => {
      const operation = paths[path].post;
      expect(operation.requestBody.content["application/json"].schema.$ref).toBe(
        `#/components/schemas/${requestSchema}`,
      );
      expect(operation.responses[successStatus].content["application/json"].schema.$ref).toBe(
        `#/components/schemas/${successSchema}`,
      );
      expect(Object.keys(operation.responses).sort()).toEqual(
        [successStatus, "400", "401", "403", "404", "409", "413", "429"].sort(),
      );
      for (const status of ["400", "401", "403", "404", "409", "413", "429"]) {
        expect(operation.responses[status].$ref).toBe("#/components/responses/Error");
      }
    },
  );

  it("types the public challenge list response", () => {
    const operation = paths["/api/reviews/{slug}/versions/{versionId}/challenges"].get;
    expect(operation.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ChallengeList",
    );
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "404"]);
  });

  it("keeps reusable challenge schemas closed", () => {
    for (const name of [
      "ChallengeCreateRequest",
      "ChallengeTransitionRequest",
      "ChallengeResponseCreateRequest",
      "ChallengeModerationRequest",
      "PublicChallengeActor",
      "PublicChallengeIdentity",
      "PublicChallengeTransition",
      "PublicChallengeResponse",
      "PublicChallenge",
      "ChallengeList",
      "ChallengeCreateResponse",
      "ChallengeTransitionResponse",
      "ChallengeResponseCreateResponse",
      "ChallengeModerationResponse",
    ]) {
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
  });

  it("parses the challenge body contract as one valid YAML scalar description", () => {
    expect(schemas.ChallengeCreateRequest.properties.body).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 10_000,
      description: "Plain text, always rendered escaped.",
    });
  });

  it("documents public tombstones while excluding private moderation and editorial fields", () => {
    expect(schemas.PublicChallenge.allOf[0].then.properties.body.const).toBe("");
    expect(schemas.PublicChallengeResponse.allOf[0].then.properties.body.const).toBe("");

    const publicFields = JSON.stringify({
      challenge: schemas.PublicChallenge,
      response: schemas.PublicChallengeResponse,
      transition: schemas.PublicChallengeTransition,
      actor: schemas.PublicChallengeActor,
      identity: schemas.PublicChallengeIdentity,
    });
    for (const privateField of [
      "actorRoleSnapshot",
      "responderRoleSnapshot",
      "removedBy",
      "removedById",
      "removedByRoleSnapshot",
      "removedAt",
      "rationale",
      "contributorRolesJsonSnapshot",
    ]) {
      expect(publicFields, privateField).not.toContain(privateField);
    }
  });
});

describe("D01 assessment provenance in OpenAPI", () => {
  it("documents graph assessment sets and provenance without replacing the legacy singleton", () => {
    expect(schemas.PublicGraphTrust.$ref).toBe(
      "#/components/schemas/PublicTrustAssessmentProvenance",
    );
    expect(Object.keys(schemas.PublicTrustAssessmentProvenance.properties)).toEqual(
      expect.arrayContaining([
        "assessmentId",
        "protocolVersion",
        "assessorType",
        "assessorId",
        "assessedAt",
        "reviewStatus",
        "verificationState",
      ]),
    );
    const confirmed = schemas.PublicGraphEdge.oneOf[0].properties;
    expect(confirmed.trust.$ref).toBe("#/components/schemas/PublicGraphTrust");
    expect(confirmed.trustAssessments.items.$ref).toBe("#/components/schemas/PublicGraphTrust");
  });

  it("documents node and review complete assessment sets with provenance", () => {
    const node = schemas.PublicNodeDetail.properties;
    expect(JSON.stringify(node.edges)).toContain("trustAssessments");
    expect(JSON.stringify(node.trustContext)).toContain("trustAssessments");

    const relation = schemas.PublicReviewRelation;
    expect(relation.additionalProperties).toBe(false);
    expect(relation.required).toContain("trusts");
    expect(relation.properties.trusts.items.$ref).toBe(
      "#/components/schemas/PublicReviewTrustAssessment",
    );
    expect(
      paths["/api/reviews/{slug}"].get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/PublicReviewDetail");
    expect(
      paths["/api/reviews/{slug}/versions/{versionId}"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/PublicReviewDetail");
  });
});

describe("comment body errors", () => {
  it("documents the implemented 413 response for comment POST", () => {
    const responses = paths["/api/reviews/{slug}/comments"].post.responses;
    expect(responses["413"].$ref).toBe("#/components/responses/Error");
  });
});
