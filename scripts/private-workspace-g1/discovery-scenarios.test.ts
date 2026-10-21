import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bindDiscoveryRoutes,
  DISCOVERY_FIXTURE_COUNT_DELTAS,
  DISCOVERY_ADDITIONAL_SELECT_GRANTS,
  DISCOVERY_METHODS,
  DISCOVERY_ROUTE_MODULES,
  type DiscoveryRouteLoaders,
} from "./discovery-routes.js";
import { DISCOVERY_TEXT, publicDiscoveryScenarios } from "./discovery-scenarios.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { programProblems } from "./scenarios.js";

const scenarios = publicDiscoveryScenarios();
const sql = readFileSync(new URL("./fixtures/discovery-fixtures.sql", import.meta.url), "utf8");

describe("public discovery GET acceptance program", () => {
  it("defines a coherent matrix of six principals with no missing-only route coverage", () => {
    expect(programProblems(scenarios)).toEqual([]);
    expect(scenarios).toHaveLength(378);
    expect(Object.keys(DISCOVERY_ROUTE_MODULES)).toHaveLength(20);
    for (const route of Object.keys(DISCOVERY_ROUTE_MODULES)) {
      for (const principal of PRINCIPAL_LABELS) {
        const success = scenarios.filter(
          (s) => s.route === route && s.principal === principal && s.expect.status === 200,
        );
        expect(success.length, `${route}/${principal}`).toBeGreaterThan(0);
        for (const scenario of success) {
          expect(
            Boolean(scenario.expect.json?.length || scenario.expect.bodyIncludes?.length),
            scenario.id,
          ).toBe(true);
        }
      }
    }
  });

  it("requires exact response equivalence across principals while retaining signed recipes", () => {
    for (const scenario of scenarios) {
      if (scenario.principal === "anonymous") expect(scenario.session.case).toBe("none");
      else {
        expect(scenario.session.case).toBe("valid");
        expect(scenario.expect.sameResponseAs).toBe(
          scenario.id.replace(/-(?:a-only|b-only|a-and-b|editor|admin)$/u, "-anonymous"),
        );
      }
    }
  });

  it("covers all nine standards formats with security headers and tombstoned denials", () => {
    const exports = scenarios.filter((s) => s.route.endsWith("export/[format]"));
    expect(exports).toHaveLength(162);
    for (const principal of PRINCIPAL_LABELS) {
      const rows = exports.filter((s) => s.principal === principal);
      expect(rows.filter((s) => s.expect.status === 200)).toHaveLength(9);
      expect(rows.filter((s) => s.expect.status === 404)).toHaveLength(18);
    }
    for (const scenario of exports.filter((s) => s.expect.status === 200)) {
      expect(scenario.expect.headers).toMatchObject({
        "cache-control": "no-store, must-revalidate",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      });
      expect(scenario.expect.headers?.["content-disposition"]).toMatch(
        /^attachment; filename="g1-fixture-review-g1-version-2\./u,
      );
    }
  });

  it("distinguishes redacted public tombstone DTOs from denied content exports and claim passports", () => {
    const redacted = scenarios.filter((s) => s.id.startsWith("discovery-review-tombstone-"));
    expect(redacted).toHaveLength(6);
    expect(
      redacted.every(
        (s) =>
          s.expect.status === 200 &&
          s.expect.json?.some(
            (check) => check.pointer === "/claims" && "length" in check && check.length === 0,
          ),
      ),
    ).toBe(true);
    const passports = scenarios.filter((s) => s.id.startsWith("discovery-passport-tombstoned-"));
    expect(passports).toHaveLength(6);
    expect(
      passports.every(
        (s) => s.expect.status === 404 && s.expect.denial?.message === "Claim not found.",
      ),
    ).toBe(true);
    expect(sql).toContain("g1-discovery-claim-tombstoned");
    expect(sql).toContain("Tombstoned discovery claim must never escape.");
  });

  it("keeps source occurrences unbound and software provenance separate from human credit", () => {
    const occurrence = scenarios.find(
      (s) => s.id === "discovery-publication-occurrence-anonymous",
    )!;
    expect(occurrence.expect.json).toContainEqual({ pointer: "/canonicalBinding", equals: null });
    expect(occurrence.expect.json).toContainEqual({ pointer: "/text", equals: DISCOVERY_TEXT });
    expect(sql).toContain('"sourceDeclarationProvenanceJson"');
    expect(sql).toContain('"kind":"software"');
    expect(sql).toContain("source-declared");
  });

  it("requires literal loader injection, with no application imports in the declarative catalog", () => {
    const load = async () => ({ GET: () => undefined });
    const loaders = {
      "api/graph": load,
      "api/search": load,
      "api/nodes": load,
      "api/nodes/[id]": load,
      "api/nodes/[id]/versions": load,
      "api/nodes/[id]/versions/[versionId]": load,
      "api/nodes/[id]/edges": load,
      "api/claims/[versionId]/[localClaimId]": load,
      "api/landscape": load,
      "api/reviews/[slug]": load,
      "api/reviews/[slug]/versions/[versionId]": load,
      "api/reviews/[slug]/diff": load,
      "api/reviews/[slug]/versions/[versionId]/export/[format]": load,
      "api/publications/[id]": load,
      "api/publications/[id]/relations": load,
      "api/publication-versions/[id]": load,
      "api/publication-versions/[id]/content": load,
      "api/publication-versions/[id]/contributors": load,
      "api/publication-versions/[id]/production-provenance": load,
      "api/publication-claim-occurrences/[id]": load,
    } satisfies DiscoveryRouteLoaders;
    expect(bindDiscoveryRoutes(loaders)).toBe(loaders);
    const extra = { ...loaders, unexpected: async () => ({}) };
    expect(() => bindDiscoveryRoutes(extra)).toThrow(/exactly/);
    const source = readFileSync(new URL("./discovery-routes.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bimport\s*\(/u);
  });

  it("keeps method coverage honest and records only the measured SELECT closure", () => {
    for (const route of Object.keys(DISCOVERY_ROUTE_MODULES)) {
      const source = readFileSync(
        new URL(`../../apps/web/src/app/${route}/route.ts`, import.meta.url),
        "utf8",
      );
      const methods = [
        ...source.matchAll(
          /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/gu,
        ),
      ].map((match) => match[1]);
      expect(methods, route).toEqual(DISCOVERY_METHODS);
    }
    expect(new Set(DISCOVERY_ADDITIONAL_SELECT_GRANTS.map((g) => g.table)).size).toBe(12);
    expect(DISCOVERY_ADDITIONAL_SELECT_GRANTS.every((g) => g.reason.length > 10)).toBe(true);
  });

  it("records exact append-only fixture deltas rather than silently changing base counts", () => {
    const inserts = [...sql.matchAll(/^INSERT INTO "([A-Za-z0-9_]+)"/gmu)].map((match) => match[1]);
    const counts = Object.fromEntries(
      Object.keys(DISCOVERY_FIXTURE_COUNT_DELTAS).map((table) => [
        table,
        inserts.filter((value) => value === table).length,
      ]),
    );
    expect(counts).toEqual(DISCOVERY_FIXTURE_COUNT_DELTAS);
    expect(sql).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE|DROP|GRANT)\b/gmu);
    expect(sql).not.toContain("private_ws");
  });
});
