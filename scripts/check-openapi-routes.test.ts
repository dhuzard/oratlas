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
  });
});
