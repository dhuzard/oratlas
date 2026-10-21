import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeGolden } from "./compare.js";
import {
  capturedIds,
  COVERAGE_SCENARIOS,
  coverageSummary,
  G1_COVERAGE_STATUS,
  PRINCIPALS,
  routeDirectories,
  scenarioIdsFor,
  SURFACES,
  surfacesForRoute,
} from "./manifest.js";
import { SUPPLEMENTAL_PROGRAMS } from "./supplemental-programs.js";
import { SCENARIOS } from "./scenarios.js";

// Offline: reads the route tree, the scenario program and the reviewed golden file only.
const ROOT = process.cwd();
const APP = resolve(ROOT, "apps/web/src/app");

describe("G1 route/principal coverage manifest", () => {
  const routes = routeDirectories(APP);

  it("accounts for every public route handler exactly once (gaps stay visible)", () => {
    expect(routes.length).toBeGreaterThan(100);
    const unaccounted = routes.filter((route) => surfacesForRoute(route).length !== 1);
    expect(unaccounted).toEqual([]);
  });

  it("has no stale route references", () => {
    for (const surface of SURFACES) {
      for (const exact of surface.exact ?? []) expect(routes, surface.id).toContain(exact);
      for (const prefix of surface.prefixes ?? []) {
        expect(
          routes.some(
            (route) =>
              (route === prefix || route.startsWith(`${prefix}/`)) &&
              surfacesForRoute(route)[0] === surface,
          ),
          `${surface.id}: ${prefix}`,
        ).toBe(true);
      }
    }
  });

  it("maps every executed scenario to exactly one surface and derives coverage from it", () => {
    for (const scenario of COVERAGE_SCENARIOS) {
      if (scenario.kind === "http") {
        expect(routes, scenario.id).toContain(scenario.route);
        expect(surfacesForRoute(scenario.route), scenario.id).toHaveLength(1);
      }
    }
    for (const surface of SURFACES) {
      const ids = scenarioIdsFor(surface);
      expect(surface.coverage === "gap", surface.id).toBe(ids.length === 0);
      if (surface.coverage === "metadata-loader-g1-empty") {
        expect(surface.channel, surface.id).toBe("http-metadata");
      }
    }
    const stateIds = COVERAGE_SCENARIOS.filter((scenario) => scenario.kind === "db-state").map(
      (s) => s.id,
    );
    expect([...capturedIds(), ...stateIds].sort()).toEqual(
      COVERAGE_SCENARIOS.map((s) => s.id).sort(),
    );
  });

  it("ties the program to the reviewed golden baseline one-to-one and in order", () => {
    const golden = upgradeGolden(
      JSON.parse(
        readFileSync(
          resolve(ROOT, "scripts/private-workspace-g1/baselines/public-routes.golden.json"),
          "utf8",
        ),
      ),
    );
    expect(golden.records.map((record) => record.id)).toEqual(SCENARIOS.map((s) => s.id));
    for (const program of SUPPLEMENTAL_PROGRAMS) {
      const supplemental = JSON.parse(
        readFileSync(
          resolve(ROOT, `scripts/private-workspace-g1/baselines/${program.name}.golden.json`),
          "utf8",
        ),
      );
      expect(supplemental.program).toBe(program.name);
      expect(upgradeGolden(supplemental.http).records.map((record) => record.id)).toEqual(
        program.scenarios.map((scenario) => scenario.id),
      );
    }
  });

  it("executes all six principal cases but declares only partial G1-empty coverage", () => {
    expect(G1_COVERAGE_STATUS).toMatch(/^G1-empty partial/);
    expect(PRINCIPALS.map((principal) => [principal.label, principal.executed])).toEqual([
      ["anonymous", true],
      ["A-only", true],
      ["B-only", true],
      ["A+B", true],
      ["EDITOR", true],
      ["ADMIN", true],
    ]);
    for (const principal of PRINCIPALS.filter((p) => p.label !== "anonymous")) {
      expect(principal.note).toMatch(/labels only/);
      expect(principal.note).toMatch(/not workspace authorization/);
    }
    const summary = coverageSummary(APP);
    expect(summary.routeFiles).toBe(routes.length);
    expect(summary.routeFilesExercised).toBe(85);
    expect(summary.routeFilesNotExercised).toBe(routes.length - 85);
    expect(summary.methodAndChannelObligations.routeMethodsWithScenarios).toBe(90);
    expect(summary.methodAndChannelObligations.routeMethodsWithAllPrincipalCases).toBe(90);
    expect(summary.invalidSessionCases.sort()).toEqual(
      ["malformed", "signed-expired", "signed-missing-user", "tampered"].sort(),
    );
    expect(summary.metadataLoaderRecords).toBe(2);
    expect(summary.gapSurfaces).toEqual(["pages", "non-http-channels"]);
    expect(summary.partialSurfaces).toEqual([
      "graph-search-discovery",
      "reviews-publications-exports",
      "protocol-snapshots",
      "auth",
      "ingestion-discussion",
      "scholarly-exchange",
      "editorial-verification-certification",
      "federation",
    ]);
  });
});
