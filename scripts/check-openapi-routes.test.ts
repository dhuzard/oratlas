import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareRoutes, normalizeRoutePath } from "./check-openapi-routes.js";

describe("normalizeRoutePath", () => {
  it("collapses OpenAPI and Next dynamic segments to a single token", () => {
    expect(normalizeRoutePath("/api/reviews/{slug}")).toBe("/api/reviews/{}");
    expect(normalizeRoutePath("/api/reviews/[slug]")).toBe("/api/reviews/{}");
  });

  it("collapses catch-all segments", () => {
    expect(normalizeRoutePath("/api/x/[...path]")).toBe("/api/x/{}");
    expect(normalizeRoutePath("/api/x/{path}")).toBe("/api/x/{}");
  });

  it("keeps static segments exact", () => {
    expect(normalizeRoutePath("/api/editorial/rounds")).toBe("/api/editorial/rounds");
  });
});

describe("compareRoutes", () => {
  it("matches documented and actual routes despite differing parameter names", () => {
    const documented = ["/api/reviews/{slug}/versions/{versionId}"];
    const actual = ["/api/reviews/[slug]/versions/[versionId]"];
    const result = compareRoutes(documented, actual);
    expect(result.undocumented).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("detects an undocumented actual route (failure condition)", () => {
    const documented = ["/api/health"];
    const actual = ["/api/health", "/api/auth/github/start"];
    const result = compareRoutes(documented, actual);
    expect(result.undocumented).toEqual(["/api/auth/github/start"]);
    expect(result.missing).toEqual([]);
  });

  it("detects a documented path with no actual route (warning condition)", () => {
    const documented = ["/api/health", "/api/legacy/thing"];
    const actual = ["/api/health"];
    const result = compareRoutes(documented, actual);
    expect(result.undocumented).toEqual([]);
    expect(result.missing).toEqual(["/api/legacy/thing"]);
  });

  it("matches a documented {path} against a Next catch-all [...path]", () => {
    const documented = ["/api/reviews/{slug}/versions/{versionId}/files/{path}"];
    const actual = ["/api/reviews/[slug]/versions/[versionId]/files/[...path]"];
    const result = compareRoutes(documented, actual);
    expect(result.undocumented).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("reports both drift directions at once", () => {
    const documented = ["/api/a", "/api/only-doc"];
    const actual = ["/api/a", "/api/only-route"];
    const result = compareRoutes(documented, actual);
    expect(result.undocumented).toEqual(["/api/only-route"]);
    expect(result.missing).toEqual(["/api/only-doc"]);
  });
});

describe("synthesis OpenAPI contracts", () => {
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
});
