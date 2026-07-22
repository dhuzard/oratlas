import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareRoutes,
  normalizeRoutePath,
  parseDocumentedOperations,
  parseRouteHandlerMethods,
} from "./check-openapi-routes.js";

describe("normalizeRoutePath", () => {
  it("normalizes OpenAPI, Next dynamic, and catch-all segments", () => {
    expect(normalizeRoutePath("/api/reviews/{slug}/files/{path}")).toBe("/api/reviews/{}/files/{}");
    expect(normalizeRoutePath("/api/reviews/[slug]/files/[...path]")).toBe(
      "/api/reviews/{}/files/{}",
    );
  });

  it("keeps static segments exact", () => {
    expect(normalizeRoutePath("/api/editorial/rounds")).toBe("/api/editorial/rounds");
  });
});

describe("method and path parity", () => {
  it("passes when method and normalized path both match", () => {
    const documented = [{ method: "get", path: "/api/reviews/{slug}" }];
    const actual = [{ method: "GET", path: "/api/reviews/[slug]" }];
    expect(compareRoutes(documented, actual)).toEqual({ undocumented: [], missing: [] });
  });

  it("fails a new verb on an already documented path", () => {
    const documented = [{ method: "GET", path: "/api/reviews/{slug}" }];
    const actual = [
      { method: "GET", path: "/api/reviews/[slug]" },
      { method: "POST", path: "/api/reviews/[slug]" },
    ];
    expect(compareRoutes(documented, actual)).toEqual({
      undocumented: [{ method: "POST", path: "/api/reviews/[slug]" }],
      missing: [],
    });
  });

  it("reports stale documented verbs independently of path coverage", () => {
    const documented = [
      { method: "GET", path: "/api/reviews/{slug}" },
      { method: "DELETE", path: "/api/reviews/{slug}" },
    ];
    const actual = [{ method: "GET", path: "/api/reviews/[slug]" }];
    expect(compareRoutes(documented, actual).missing).toEqual([
      { method: "DELETE", path: "/api/reviews/{slug}" },
    ]);
  });

  it("detects an undocumented actual path", () => {
    const documented = [{ method: "GET", path: "/api/health" }];
    const actual = [
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/new-resource" },
    ];
    expect(compareRoutes(documented, actual).undocumented).toEqual([
      { method: "GET", path: "/api/new-resource" },
    ]);
  });

  it("detects a documented path with no actual handler", () => {
    const documented = [
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/legacy/thing" },
    ];
    const actual = [{ method: "GET", path: "/api/health" }];
    expect(compareRoutes(documented, actual).missing).toEqual([
      { method: "GET", path: "/api/legacy/thing" },
    ]);
  });

  it("matches an OpenAPI path parameter against a Next catch-all segment", () => {
    const documented = [
      { method: "GET", path: "/api/reviews/{slug}/versions/{versionId}/files/{path}" },
    ];
    const actual = [
      { method: "GET", path: "/api/reviews/[slug]/versions/[versionId]/files/[...path]" },
    ];
    expect(compareRoutes(documented, actual)).toEqual({ undocumented: [], missing: [] });
  });

  it("reports both drift directions at once", () => {
    const documented = [
      { method: "GET", path: "/api/a" },
      { method: "POST", path: "/api/only-doc" },
    ];
    const actual = [
      { method: "GET", path: "/api/a" },
      { method: "DELETE", path: "/api/only-route" },
    ];
    expect(compareRoutes(documented, actual)).toEqual({
      undocumented: [{ method: "DELETE", path: "/api/only-route" }],
      missing: [{ method: "POST", path: "/api/only-doc" }],
    });
  });
});

describe("operation discovery inputs", () => {
  it("parses only HTTP operations nested under API paths", () => {
    const yaml = `openapi: 3.1.0
paths:
  /api/items/{id}:
    parameters: []
    get:
      responses: {}
    PATCH:
      responses: {}
  /web/page:
    get:
      responses: {}
components:
  schemas: {}
`;
    expect(parseDocumentedOperations(yaml)).toEqual([
      { method: "GET", path: "/api/items/{id}" },
      { method: "PATCH", path: "/api/items/{id}" },
    ]);
  });

  it("recognizes function, const, and aliased route-handler exports", () => {
    const source = `
      export async function GET() {}
      export function OPTIONS() {}
      export const POST = async () => {};
      const remove = () => {};
      export { remove as DELETE };
      const text = "export async function PATCH() {}";
      // export function PUT() {}
    `;
    expect(parseRouteHandlerMethods(source)).toEqual(["DELETE", "GET", "OPTIONS", "POST"]);
  });
});

describe("synthesis OpenAPI contracts", () => {
  it("keeps archive synthesis discovery and bounded-total semantics in the public contract", () => {
    const openapi = readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8");
    const component = (name: string) => {
      const start = openapi.indexOf(`    ${name}:`);
      expect(start, `${name} component`).toBeGreaterThanOrEqual(0);
      const next = openapi.slice(start + 4).search(/^ {4}[A-Za-z][A-Za-z0-9]+:/m);
      return next < 0 ? openapi.slice(start) : openapi.slice(start, start + 4 + next);
    };
    const pathStart = openapi.indexOf("  /api/search:");
    expect(pathStart).toBeGreaterThanOrEqual(0);
    const pathTail = openapi.slice(pathStart + 2);
    const nextPath = pathTail.search(/^ {2}\/api\//m);
    const operation =
      nextPath < 0 ? openapi.slice(pathStart) : openapi.slice(pathStart, pathStart + 2 + nextPath);

    expect(operation).toContain("repository reviews, knowledge nodes, and accepted AI syntheses");
    expect(operation).toContain("enum: [all, review, node, synthesis]");
    expect(operation).toContain('$ref: "#/components/schemas/ArchiveSearchResponse"');
    expect(operation).toContain("strict current-head and integrity validation");
    expect(operation).toContain("capped at 500");

    for (const schema of [
      "ArchiveRepositoryReviewResult",
      "ArchiveNodeResult",
      "ArchiveSynthesisFreshness",
      "ArchiveSynthesisResult",
      "ArchiveSynthesisCandidateScan",
      "ArchiveSearchResponse",
    ]) {
      const shape = component(schema);
      expect(shape, `${schema} closes its allowlist`).toContain("additionalProperties: false");
      expect(shape, `${schema} declares required fields`).toContain("required:");
      expect(shape, `${schema} declares properties`).toContain("properties:");
    }

    const synthesis = component("ArchiveSynthesisResult");
    expect(synthesis).toContain("contentType: { const: synthesis }");
    expect(synthesis).toContain('$ref: "#/components/schemas/PublicSynthesisVersion"');
    expect(synthesis).toContain('$ref: "#/components/schemas/ArchiveSynthesisFreshness"');

    const freshness = component("ArchiveSynthesisFreshness");
    expect(freshness).toContain("enum: [unchecked, fresh, stale]");
    expect(freshness).toContain("affectedReferenceCount");
    expect(freshness).toContain("maximum: 1201");
    expect(freshness).toContain("minimum: 1");
    expect(freshness).toContain("const: 0");

    const version = component("PublicSynthesisVersion");
    expect(version).toContain("versionDoi:");
    expect(version).toContain("conceptDoi:");
    expect(version).toContain('not: { pattern: "^10\\\\.5555/" }');
    expect(version).toContain("distinct when both are present");

    const scan = component("ArchiveSynthesisCandidateScan");
    expect(scan).toContain("const: 500");
    expect(scan).toContain("limitReached:");
    expect(scan).toContain("totals then describe only the bounded candidate scan");

    const response = component("ArchiveSearchResponse");
    expect(response).toContain("synthesisCandidateScan");
    expect(response).toContain("not an asserted global synthesis");
    expect(response).toContain('$ref: "#/components/schemas/ArchiveSynthesisResult"');
  });

  it("uses reusable concrete request and response schemas", () => {
    const openapi = readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8");
    const component = (name: string) => {
      const start = openapi.indexOf(`    ${name}:`);
      expect(start, `${name} component`).toBeGreaterThanOrEqual(0);
      const next = openapi.slice(start + 4).search(/^ {4}[A-Za-z][A-Za-z0-9]+:/m);
      return next < 0 ? openapi.slice(start) : openapi.slice(start, start + 4 + next);
    };
    for (const schema of [
      "SynthesisSelector",
      "SynthesisGenerationRequest",
      "SynthesisAcceptanceChecklist",
      "SynthesisDecision",
      "EditorialSynthesisDraft",
      "SynthesisDecisionResult",
      "PublicSynthesisReview",
    ]) {
      expect(openapi).toContain(`    ${schema}:`);
    }
    expect(openapi).toContain(
      'schema: { $ref: "#/components/schemas/SynthesisGenerationRequest" }',
    );
    expect(openapi).toContain('schema: { $ref: "#/components/schemas/SynthesisDecision" }');
    expect(openapi).toContain('schema: { $ref: "#/components/schemas/PublicSynthesisReview" }');

    for (const schema of [
      "SynthesisReviewCitation",
      "SynthesisReviewParagraph",
      "SynthesisReviewSection",
      "SynthesisReviewDocument",
      "SynthesisPipelineSoftware",
      "SynthesisGenerationProvenance",
      "SynthesisApprovingEditor",
      "AcceptedSynthesisProvenance",
      "EditorialSynthesisCitation",
      "PublicSynthesisCitation",
      "PublicSynthesisVersion",
      "SynthesisFreshness",
      "SynthesisAffectedReference",
      "SynthesisStalenessEvaluationResult",
      "SynthesisStalenessScanResult",
      "SynthesisRegenerationProposalDecision",
      "SynthesisRegenerationProposalDecisionResult",
      "EditorialSynthesisDraft",
      "PublicSynthesisReview",
    ]) {
      const shape = component(schema);
      expect(shape, `${schema} closes its allowlist`).toContain("additionalProperties: false");
      expect(shape, `${schema} declares required fields`).toContain("required:");
      expect(shape, `${schema} declares properties`).toContain("properties:");
    }

    const draft = component("EditorialSynthesisDraft");
    expect(draft).toContain('$ref: "#/components/schemas/SynthesisReviewDocument"');
    expect(draft).toContain('$ref: "#/components/schemas/SynthesisGenerationProvenance"');
    expect(draft).toContain('$ref: "#/components/schemas/EditorialSynthesisCitation"');
    const publicReview = component("PublicSynthesisReview");
    expect(publicReview).toContain('$ref: "#/components/schemas/SynthesisReviewDocument"');
    expect(publicReview).toContain('$ref: "#/components/schemas/AcceptedSynthesisProvenance"');
    expect(publicReview).toContain('$ref: "#/components/schemas/PublicSynthesisCitation"');
    expect(publicReview).toContain('$ref: "#/components/schemas/PublicSynthesisVersion"');
    expect(publicReview).toContain('$ref: "#/components/schemas/SynthesisFreshness"');
    expect(publicReview).not.toMatch(/packetJson|selectorJson|agentRunId|requestKey|errorCode/);
  });

  it("documents the shared authenticated mutation failure surface for staleness routes", () => {
    const openapi = readFileSync(resolve(process.cwd(), "docs/openapi.yaml"), "utf8");
    for (const path of [
      "/api/editorial/syntheses/staleness/scan",
      "/api/editorial/syntheses/staleness/{id}/decision",
    ]) {
      const start = openapi.indexOf(`  ${path}:`);
      expect(start).toBeGreaterThanOrEqual(0);
      const tail = openapi.slice(start + 2);
      const next = tail.search(/^ {2}\/api\//m);
      const operation = next < 0 ? openapi.slice(start) : openapi.slice(start, start + 2 + next);
      expect(operation).toContain("security: [{ session: [] }]");
      for (const status of ["400", "401", "403", "413", "429"]) {
        expect(operation).toContain(`"${status}":`);
      }
    }
  });
});
